export const PHASES = ["beta", "alpha", "theta", "gamma"] as const;
export type PhaseKey = (typeof PHASES)[number];

export interface ReconcileSegment {
  phase: PhaseKey;
  pause_after_ms: number;
  actual_duration_sec: number;
  scheduled_pause_after_ms?: number;
}

export interface ReconcileInput {
  phaseBudgetSec: Record<PhaseKey, number>;
  segments: ReconcileSegment[];
}

export interface ReconcileResult {
  segments: ReconcileSegment[];
  /** Phases where voiced seconds alone exceed budget by more than 2% */
  overBudgetPhases: PhaseKey[];
}

export function reconcilePhaseTiming(input: ReconcileInput): ReconcileResult {
  const byPhase = new Map<PhaseKey, ReconcileSegment[]>();
  for (const phase of PHASES) {
    byPhase.set(phase, []);
  }
  for (const segment of input.segments) {
    byPhase.get(segment.phase)?.push({ ...segment });
  }

  const overBudgetPhases: PhaseKey[] = [];
  const reconciled: ReconcileSegment[] = [];

  for (const phase of PHASES) {
    const segments = byPhase.get(phase) ?? [];
    const budgetSec = input.phaseBudgetSec[phase];
    const voicedSec = segments.reduce((sum, s) => sum + s.actual_duration_sec, 0);
    const rawPauseMs = segments.reduce((sum, s) => sum + s.pause_after_ms, 0);
    const remainingMs = Math.max(0, budgetSec * 1000 - voicedSec * 1000);

    if (voicedSec > budgetSec * 1.02) {
      overBudgetPhases.push(phase);
    }

    if (rawPauseMs > 0) {
      const scale = rawPauseMs > 0 ? remainingMs / rawPauseMs : 0;
      for (const s of segments) {
        s.scheduled_pause_after_ms = Math.max(0, Math.round(s.pause_after_ms * scale));
        reconciled.push(s);
      }
    } else {
      const perGap = Math.round(remainingMs / Math.max(1, segments.length - 1));
      for (const [i, s] of segments.entries()) {
        s.scheduled_pause_after_ms = i === segments.length - 1 ? 0 : perGap;
        reconciled.push(s);
      }
    }
  }

  return { segments: reconciled, overBudgetPhases };
}
