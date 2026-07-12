import type { ServiceClient } from "@/lib/db/service-client";
import type { CompilerInput } from "@/lib/session/derive";
import { applyDedupeHits, planSegmentDedupe } from "./dedupe-plan";
import { reconcileSegments } from "./reconcile-persist";
import { segmentContentHash } from "./segment-rows";
import { runSynthesizeSegment } from "./synthesize-segment-job";
import {
  loadScriptSynthesisIdentity,
  type ScriptVoiceSource,
} from "./synthesis-identity";

export async function retryFailedScriptSynthesis(
  supabase: ServiceClient,
  scriptId: string,
): Promise<{ hits: number; misses: number; status: "ready" }> {
  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select(
      "id, user_id, status, provider, stock_voice_id, voice_profile_id, tts_model_id, compiler_input",
    )
    .eq("id", scriptId)
    .single();

  if (scriptError || !script) {
    throw new Error(`script not found: ${scriptError?.message ?? scriptId}`);
  }
  if (script.status !== "failed") {
    throw new Error(`script status must be failed (got ${script.status})`);
  }

  const compilerInput = script.compiler_input as CompilerInput | null;
  const phaseBudget = compilerInput?.session?.phase_budget_sec;
  if (!phaseBudget) {
    throw new Error("compiler_input.phase_budget_sec missing");
  }

  const synthesisIdentity = await loadScriptSynthesisIdentity(
    supabase,
    script as ScriptVoiceSource,
  );

  const { data: segments, error: segmentError } = await supabase
    .from("script_segments")
    .select("id, text, pacing_wpm, seq, content_hash, synthesis_status")
    .eq("script_id", scriptId)
    .order("seq");

  if (segmentError) {
    throw new Error(segmentError.message);
  }
  if (!segments || segments.length === 0) {
    throw new Error("no persisted segments to retry");
  }

  for (const segment of segments) {
    const content_hash = segmentContentHash(segment.text, synthesisIdentity);
    const { error: updateError } = await supabase
      .from("script_segments")
      .update({
        content_hash,
        synthesis_status: "pending",
        audio_file_id: null,
        actual_duration_sec: null,
      })
      .eq("id", segment.id);

    if (updateError) {
      throw new Error(`segment hash update failed: ${updateError.message}`);
    }
  }

  const { data: refreshedSegments, error: refreshError } = await supabase
    .from("script_segments")
    .select("id, content_hash, text, pacing_wpm, seq")
    .eq("script_id", scriptId)
    .order("seq");

  if (refreshError || !refreshedSegments) {
    throw new Error(refreshError?.message ?? "failed to reload segments");
  }

  await supabase.from("scripts").update({ status: "synthesizing" }).eq("id", scriptId);

  const plan = await planSegmentDedupe(
    supabase,
    { userId: script.user_id, assetScope: synthesisIdentity.assetScope },
    refreshedSegments,
  );
  await applyDedupeHits(supabase, plan.hits);

  if (plan.misses.length > 0) {
    const ordered = [...refreshedSegments].sort((a, b) => a.seq - b.seq);
    for (const miss of plan.misses) {
      const orderedIndex = ordered.findIndex((segment) => segment.id === miss.segmentId);
      const previousText = orderedIndex > 0 ? ordered[orderedIndex - 1]?.text : undefined;
      const nextText =
        orderedIndex >= 0 && orderedIndex < ordered.length - 1
          ? ordered[orderedIndex + 1]?.text
          : undefined;

      await runSynthesizeSegment(supabase, {
        script_id: scriptId,
        segment_id: miss.segmentId,
        user_id: script.user_id,
        dedupe_key: miss.contentHash,
        text: miss.text,
        pacing_wpm: miss.pacingWpm,
        previous_text: previousText,
        next_text: nextText,
      });
    }
  }

  const { data: synthSegments, error: synthError } = await supabase
    .from("script_segments")
    .select("id, phase, pause_after_ms, actual_duration_sec, seq")
    .eq("script_id", scriptId)
    .order("seq");

  if (synthError) {
    throw new Error(synthError.message);
  }

  const { updates, overBudgetPhases } = reconcileSegments(synthSegments ?? [], phaseBudget);
  for (const update of updates) {
    const { error } = await supabase
      .from("script_segments")
      .update({ scheduled_pause_after_ms: update.scheduled_pause_after_ms })
      .eq("id", update.id);
    if (error) {
      throw new Error(`reconcile update failed: ${error.message}`);
    }
  }

  const { data: finalSegments, error: finalError } = await supabase
    .from("script_segments")
    .select("actual_duration_sec, scheduled_pause_after_ms")
    .eq("script_id", scriptId);

  if (finalError) {
    throw new Error(finalError.message);
  }

  const totalDurationSec = Math.round(
    (finalSegments ?? []).reduce(
      (sum, row) =>
        sum +
        Number(row.actual_duration_sec ?? 0) +
        Number(row.scheduled_pause_after_ms ?? 0) / 1000,
      0,
    ),
  );

  let overageWarning: string | null = null;
  if (overBudgetPhases.length > 0) {
    overageWarning = `OVERAGE: phases ${overBudgetPhases.join(",")} exceed voiced budget by >2%`;
  }

  await supabase
    .from("scripts")
    .update({
      status: "ready",
      total_duration_sec: totalDurationSec,
      error_message: overageWarning,
    })
    .eq("id", scriptId);

  return { hits: plan.hits.length, misses: plan.misses.length, status: "ready" };
}
