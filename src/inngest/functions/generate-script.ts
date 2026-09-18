import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import {
  CompilerError,
  formatCompilerFailureMessage,
} from "@/lib/compiler/compile";
import {
  assessCompileLength,
  resolveCompileFailOpen,
  runCompileAttempt2FailOpen,
  shouldRunCompileAttempt2,
} from "@/lib/pipeline/compile-length-steps";
import {
  runCompilePrimaryAttempt,
  shouldRetryCompileOnTimeout,
} from "@/lib/pipeline/compile-timeout-retry";
import { applyDedupeHits, linkPendingSegmentsFromAudioCache, planSegmentDedupe } from "@/lib/pipeline/dedupe-plan";
import { deriveSegmentRows } from "@/lib/pipeline/segment-rows";
import { finalizeSynthesizedScript } from "@/lib/pipeline/finalize-script";
import { markScriptFailed } from "@/lib/pipeline/mark-script-failed";
import { shouldLeaveForSynthesisReaper } from "@/lib/pipeline/reap-stuck-scripts";
import {
  loadScriptSynthesisIdentity,
  type ScriptVoiceSource,
} from "@/lib/pipeline/synthesis-identity";
import { capturePathError } from "@/lib/sentry/capture";
import type { CompilerInput } from "@/lib/session/derive";
import type { Manifest } from "@/lib/contracts/manifest";
import { synthesizeSegment } from "./synthesize-segment";

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
          .select(
            "id, user_id, goal_version_id, compiler_input, status, provider, stock_voice_id, voice_profile_id, tts_model_id",
          )
          .eq("id", scriptId)
          .single();

        if (error || !data) {
          throw new Error(`script not found: ${error?.message ?? scriptId}`);
        }

        return data as ScriptVoiceSource & {
          id: string;
          goal_version_id: string;
          compiler_input: CompilerInput;
          status: string;
        };
      });

      const synthesisIdentity = await step.run("resolve-synthesis-identity", async () => {
        return loadScriptSynthesisIdentity(getServiceClient(), scriptCtx);
      });

      // Each Claude compile is its own step → fresh ~300s budget (route maxDuration=300).
      // Soft budget is COMPILE_STEP_BUDGET_MS (~270s). Never stack two compiles in one
      // invocation (FUNCTION_INVOCATION_TIMEOUT). Soft-timeout → one separate-step retry.
      const attempt1Result = await step.run("compile-attempt-1", async () => {
        try {
          return await runCompilePrimaryAttempt(scriptCtx.compiler_input);
        } catch (error) {
          if (error instanceof CompilerError) {
            await markScriptFailed(scriptId, formatCompilerFailureMessage(error));
            throw new NonRetriableError(formatCompilerFailureMessage(error));
          }
          throw error;
        }
      });

      let attempt1: Manifest;
      if (shouldRetryCompileOnTimeout(attempt1Result)) {
        console.error(
          `compile-attempt-1 soft-timeout after ${attempt1Result.durationMs}ms; ` +
            `scheduling compile-attempt-1-retry as separate step`,
        );
        attempt1 = await step.run("compile-attempt-1-retry", async () => {
          try {
            const retry = await runCompilePrimaryAttempt(scriptCtx.compiler_input);
            if (retry.status === "timeout") {
              await markScriptFailed(scriptId, retry.message);
              throw new NonRetriableError(retry.message);
            }
            console.error(
              `compile-attempt-1-retry succeeded in ${retry.durationMs}ms`,
            );
            return retry.manifest;
          } catch (error) {
            if (error instanceof NonRetriableError) throw error;
            if (error instanceof CompilerError) {
              await markScriptFailed(scriptId, formatCompilerFailureMessage(error));
              throw new NonRetriableError(formatCompilerFailureMessage(error));
            }
            throw error;
          }
        });
      } else {
        attempt1 = attempt1Result.manifest;
      }

      const lengthCheck = await step.run("compile-length-check", async () => {
        const check = assessCompileLength(attempt1, scriptCtx.compiler_input);
        console.error(
          `compile-length-check: estimate=${check.estimatedSec.toFixed(1)}s ` +
            `target=${check.targetSec}s underfilled=${check.underfilled ? 1 : 0}`,
        );
        return check;
      });

      let manifest: Manifest = attempt1;
      if (shouldRunCompileAttempt2(lengthCheck)) {
        const attempt2 = await step.run("compile-attempt-2", async () => {
          // Fail-open: timeout / validation failure → keep attempt-1.
          return runCompileAttempt2FailOpen(
            scriptCtx.compiler_input,
            lengthCheck.expandUserMessage!,
          );
        });
        manifest = resolveCompileFailOpen({ attempt1, attempt2 });
        if (!attempt2) {
          console.error(
            "compile-attempt-2: fail-open to attempt-1; dwelling will fine-tune length",
          );
        }
      }

      await step.run("persist-segments", async () => {
        const supabase = getServiceClient();
        const rows = deriveSegmentRows(manifest, {
          scriptId: scriptCtx.id,
          userId: scriptCtx.user_id,
          synthesisIdentity,
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
        const plan = await planSegmentDedupe(
          supabase,
          { userId: scriptCtx.user_id, assetScope: synthesisIdentity.assetScope },
          segments,
        );
        await applyDedupeHits(supabase, plan.hits);

        await supabase.from("scripts").update({ status: "synthesizing" }).eq("id", scriptId);

        return plan;
      });

      if (dedupe.misses.length > 0) {
        const textBySegmentId = new Map(segments.map((segment) => [segment.id, segment.text]));
        const ordered = [...segments].sort((a, b) => a.seq - b.seq);

        await Promise.allSettled(
          dedupe.misses.map((miss, index) => {
            const orderedIndex = ordered.findIndex((segment) => segment.id === miss.segmentId);
            const previousText =
              orderedIndex > 0 ? ordered[orderedIndex - 1]?.text : undefined;
            const nextText =
              orderedIndex >= 0 && orderedIndex < ordered.length - 1
                ? ordered[orderedIndex + 1]?.text
                : undefined;

            return step.invoke(`synthesize-${index}`, {
              function: synthesizeSegment,
              data: {
                script_id: scriptId,
                segment_id: miss.segmentId,
                user_id: scriptCtx.user_id,
                dedupe_key: miss.contentHash,
                text: textBySegmentId.get(miss.segmentId) ?? miss.text,
                pacing_wpm: miss.pacingWpm,
                previous_text: previousText,
                next_text: nextText,
              },
            });
          }),
        );
      }

      await step.run("link-shared-cues", async () => {
        const supabase = getServiceClient();
        await linkPendingSegmentsFromAudioCache(
          supabase,
          { userId: scriptCtx.user_id, assetScope: synthesisIdentity.assetScope },
          scriptId,
        );
      });

      const incomplete = await step.run("check-synthesis-complete", async () => {
        const supabase = getServiceClient();
        const { data, error } = await supabase
          .from("script_segments")
          .select("synthesis_status")
          .eq("script_id", scriptId);
        if (error) throw new Error(error.message);
        return (data ?? []).some((row) => row.synthesis_status !== "ready");
      });

      if (incomplete) {
        console.error(
          "generate-script: segments still not ready after fan-out; leaving synthesizing for reaper",
        );
        return { script_id: scriptId, status: "synthesizing", incomplete: true };
      }

      await step.run("reconcile-and-finalize", async () => {
        await finalizeSynthesizedScript(
          getServiceClient(),
          scriptId,
          scriptCtx.compiler_input.session.phase_budget_sec,
        );
      });

      return { script_id: scriptId, status: "ready" };
    } catch (error) {
      capturePathError(error, "pipeline.generate_script");
      const message =
        error instanceof CompilerError
          ? formatCompilerFailureMessage(error)
          : error instanceof Error
            ? error.message
            : "unknown error";

      const scriptStatus = await step.run("load-status-on-error", async () => {
        const supabase = getServiceClient();
        const { data } = await supabase
          .from("scripts")
          .select("status")
          .eq("id", scriptId)
          .maybeSingle();
        return data?.status ?? "generating";
      });

      if (shouldLeaveForSynthesisReaper(scriptStatus)) {
        console.error(
          `generate-script: synthesis-phase error (${message}); leaving synthesizing for reaper`,
        );
        return { script_id: scriptId, status: "synthesizing", incomplete: true };
      }

      await step.run("mark-failed", async () => {
        await markScriptFailed(scriptId, message);
      });

      throw error;
    }
  },
);
