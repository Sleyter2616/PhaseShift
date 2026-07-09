import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import {
  CompilerError,
  compileManifest,
  formatCompilerFailureMessage,
} from "@/lib/compiler/compile";
import { getServiceClient } from "@/lib/db/service-client";
import { applyDedupeHits, planSegmentDedupe } from "@/lib/pipeline/dedupe-plan";
import { deriveSegmentRows } from "@/lib/pipeline/segment-rows";
import { reconcileSegments } from "@/lib/pipeline/reconcile-persist";
import type { CompilerInput } from "@/lib/session/derive";
import { synthesizeSegment } from "./synthesize-segment";

async function markScriptFailed(scriptId: string, message: string): Promise<void> {
  const supabase = getServiceClient();
  await supabase
    .from("scripts")
    .update({ status: "failed", error_message: message.slice(0, 4000) })
    .eq("id", scriptId);
}

export const generateScript = inngest.createFunction(
  {
    id: "generate-script",
    retries: 1,
    triggers: [{ event: "script/generate.requested" }],
  },
  async ({ event, step }) => {
    const scriptId = event.data.script_id;

    try {
      const scriptCtx = await step.run("load-script", async () => {
        const supabase = getServiceClient();
        const { data, error } = await supabase
          .from("scripts")
          .select("id, user_id, goal_version_id, compiler_input, status")
          .eq("id", scriptId)
          .single();

        if (error || !data) {
          throw new Error(`script not found: ${error?.message ?? scriptId}`);
        }

        return data as {
          id: string;
          user_id: string;
          goal_version_id: string;
          compiler_input: CompilerInput;
          status: string;
        };
      });

      const manifest = await step.run("compile", async () => {
        try {
          return await compileManifest(scriptCtx.compiler_input);
        } catch (error) {
          if (error instanceof CompilerError) {
            await markScriptFailed(scriptId, formatCompilerFailureMessage(error));
            throw new NonRetriableError(formatCompilerFailureMessage(error));
          }
          throw error;
        }
      });

      await step.run("persist-segments", async () => {
        const supabase = getServiceClient();
        const rows = deriveSegmentRows(manifest, {
          scriptId: scriptCtx.id,
          userId: scriptCtx.user_id,
        });

        const { error: deleteError } = await supabase
          .from("script_segments")
          .delete()
          .eq("script_id", scriptId);
        if (deleteError) throw new Error(deleteError.message);

        const { error: insertError } = await supabase.from("script_segments").insert(rows);
        if (insertError) throw new Error(insertError.message);
      });

      const segments = await step.run("load-segments", async () => {
        const supabase = getServiceClient();
        const { data, error } = await supabase
          .from("script_segments")
          .select("id, content_hash, text, pacing_wpm, phase, pause_after_ms, seq")
          .eq("script_id", scriptId)
          .order("seq");

        if (error) throw new Error(error.message);
        return data ?? [];
      });

      const dedupe = await step.run("dedupe-plan", async () => {
        const supabase = getServiceClient();
        const plan = await planSegmentDedupe(supabase, scriptCtx.user_id, segments);
        await applyDedupeHits(supabase, plan.hits);

        await supabase.from("scripts").update({ status: "synthesizing" }).eq("id", scriptId);

        return plan;
      });

      if (dedupe.misses.length > 0) {
        await Promise.all(
          dedupe.misses.map((miss, index) =>
            step.invoke(`synthesize-${index}`, {
              function: synthesizeSegment,
              data: {
                script_id: scriptId,
                segment_id: miss.segmentId,
                user_id: scriptCtx.user_id,
                dedupe_key: miss.contentHash,
                text: miss.text,
                pacing_wpm: miss.pacingWpm,
              },
            }),
          ),
        );
      }

      const reconcileResult = await step.run("reconcile", async () => {
        const supabase = getServiceClient();
        const { data: synthSegments, error } = await supabase
          .from("script_segments")
          .select("id, phase, pause_after_ms, actual_duration_sec, seq")
          .eq("script_id", scriptId)
          .order("seq");

        if (error) throw new Error(error.message);

        const phaseBudget = scriptCtx.compiler_input.session.phase_budget_sec;
        const { updates, overBudgetPhases } = reconcileSegments(
          synthSegments ?? [],
          phaseBudget,
        );

        for (const update of updates) {
          await supabase
            .from("script_segments")
            .update({ scheduled_pause_after_ms: update.scheduled_pause_after_ms })
            .eq("id", update.id);
        }

        let overageWarning: string | null = null;
        if (overBudgetPhases.length > 0) {
          overageWarning = `OVERAGE: phases ${overBudgetPhases.join(",")} exceed voiced budget by >2%`;
        }

        return { overageWarning };
      });

      await step.run("finalize", async () => {
        const supabase = getServiceClient();
        const { data: finalSegments, error } = await supabase
          .from("script_segments")
          .select("actual_duration_sec, scheduled_pause_after_ms")
          .eq("script_id", scriptId);

        if (error) throw new Error(error.message);

        const totalDurationSec = Math.round(
          (finalSegments ?? []).reduce(
            (sum, row) =>
              sum +
              Number(row.actual_duration_sec ?? 0) +
              Number(row.scheduled_pause_after_ms ?? 0) / 1000,
            0,
          ),
        );

        await supabase
          .from("scripts")
          .update({
            status: "ready",
            total_duration_sec: totalDurationSec,
            error_message: reconcileResult.overageWarning,
          })
          .eq("id", scriptId);
      });

      return { script_id: scriptId, status: "ready" };
    } catch (error) {
      const message =
        error instanceof CompilerError
          ? formatCompilerFailureMessage(error)
          : error instanceof Error
            ? error.message
            : "unknown error";

      await step.run("mark-failed", async () => {
        await markScriptFailed(scriptId, message);
      });

      throw error;
    }
  },
);
