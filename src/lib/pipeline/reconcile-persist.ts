import { reconcilePhaseTiming, PHASES, type PhaseKey } from "../schedule/reconcile";

export interface SegmentForReconcile {
  id: string;
  phase: string;
  seq: number;
  pause_after_ms: number;
  actual_duration_sec: number | null;
}

export function reconcileSegments(
  segments: SegmentForReconcile[],
  phaseBudgetSec: Record<PhaseKey, number>,
): {
  updates: Array<{ id: string; scheduled_pause_after_ms: number }>;
  overBudgetPhases: PhaseKey[];
} {
  const updates: Array<{ id: string; scheduled_pause_after_ms: number }> = [];
  const overBudgetPhases: PhaseKey[] = [];

  for (const phase of PHASES) {
    const phaseSegs = segments
      .filter((segment) => segment.phase === phase)
      .sort((a, b) => a.seq - b.seq);

    if (phaseSegs.length === 0) continue;

    const result = reconcilePhaseTiming({
      phaseBudgetSec,
      segments: phaseSegs.map((segment) => ({
        phase,
        pause_after_ms: segment.pause_after_ms,
        actual_duration_sec: Number(segment.actual_duration_sec ?? 0),
      })),
    });

    overBudgetPhases.push(...result.overBudgetPhases);

    phaseSegs.forEach((segment, index) => {
      updates.push({
        id: segment.id,
        scheduled_pause_after_ms: result.segments[index]?.scheduled_pause_after_ms ?? 0,
      });
    });
  }

  return { updates, overBudgetPhases };
}
