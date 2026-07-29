import {
  reconcileLengthToTarget,
  PHASES,
  type PhaseKey,
} from "../schedule/reconcile";

export interface SegmentForReconcile {
  id: string;
  phase: string;
  seq: number;
  pause_after_ms: number;
  actual_duration_sec: number | null;
}

function isPhaseKey(phase: string): phase is PhaseKey {
  return (PHASES as readonly string[]).includes(phase);
}

export function reconcileSegments(
  segments: SegmentForReconcile[],
  phaseBudgetSec: Record<PhaseKey, number>,
): {
  updates: Array<{ id: string; scheduled_pause_after_ms: number }>;
  overBudgetPhases: PhaseKey[];
  targetTotalSec: number;
  totalSec: number;
  withinTolerance: boolean;
} {
  const ordered = [...segments].sort((a, b) => a.seq - b.seq);
  const targetTotalSec = PHASES.reduce(
    (sum, phase) => sum + (phaseBudgetSec[phase] ?? 0),
    0,
  );

  const result = reconcileLengthToTarget({
    targetTotalSec,
    phaseBudgetSec,
    segments: ordered.map((segment) => ({
      phase: isPhaseKey(segment.phase) ? segment.phase : "theta",
      pause_after_ms: segment.pause_after_ms,
      actual_duration_sec: Number(segment.actual_duration_sec ?? 0),
    })),
  });

  const updates = ordered.map((segment, index) => ({
    id: segment.id,
    scheduled_pause_after_ms: result.segments[index]?.scheduled_pause_after_ms ?? 0,
  }));

  return {
    updates,
    overBudgetPhases: result.overBudgetPhases,
    targetTotalSec: result.targetTotalSec,
    totalSec: result.totalSec,
    withinTolerance: result.withinTolerance,
  };
}
