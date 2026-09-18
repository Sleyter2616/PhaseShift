import type { ServiceClient } from "../db/service-client";
import type { CompilerInput } from "../session/derive";
import type { PhaseKey } from "../schedule/reconcile";
import { reconcileSegments } from "./reconcile-persist";

export function phaseBudgetFromCompilerInput(
  compilerInput: unknown,
): Record<PhaseKey, number> {
  const budget = (compilerInput as CompilerInput | null)?.session?.phase_budget_sec;
  if (!budget) {
    throw new Error("compiler_input.phase_budget_sec missing");
  }
  return budget;
}

/**
 * After every segment is ready: stamp scheduled pauses and mark the script ready.
 * Shared by generate-script, retry-synthesis, and the stuck-synthesis reaper.
 */
export async function finalizeSynthesizedScript(
  supabase: ServiceClient,
  scriptId: string,
  phaseBudgetSec: Record<PhaseKey, number>,
): Promise<{ totalSec: number; overageWarning: string | null }> {
  const { data: synthSegments, error } = await supabase
    .from("script_segments")
    .select("id, phase, pause_after_ms, actual_duration_sec, seq")
    .eq("script_id", scriptId)
    .order("seq");

  if (error) throw new Error(error.message);

  const { updates, overBudgetPhases, totalSec, targetTotalSec, withinTolerance } =
    reconcileSegments(synthSegments ?? [], phaseBudgetSec);

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from("script_segments")
      .update({ scheduled_pause_after_ms: update.scheduled_pause_after_ms })
      .eq("id", update.id);
    if (updateError) {
      throw new Error(`reconcile update failed: ${updateError.message}`);
    }
  }

  let overageWarning: string | null = null;
  if (overBudgetPhases.length > 0) {
    overageWarning = `OVERAGE: phases ${overBudgetPhases.join(",")} exceed voiced budget by >2%`;
  }
  if (!withinTolerance) {
    const lengthWarn = `LENGTH: reconciled ${totalSec.toFixed(1)}s vs target ${targetTotalSec}s`;
    overageWarning = overageWarning ? `${overageWarning}; ${lengthWarn}` : lengthWarn;
  }

  const { error: scriptError } = await supabase
    .from("scripts")
    .update({
      status: "ready",
      total_duration_sec: Math.round(totalSec),
      error_message: overageWarning,
    })
    .eq("id", scriptId);

  if (scriptError) throw new Error(scriptError.message);

  return { totalSec, overageWarning };
}
