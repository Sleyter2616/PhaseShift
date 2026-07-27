export const PHASES = ["beta", "alpha", "theta", "gamma"] as const;
export type PhaseKey = (typeof PHASES)[number];

/** Hard cap: never schedule multi-minute dead air between segments. */
export const MAX_SCHEDULED_PAUSE_MS = 5_000;

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

/**
 * Map compiler pause_after_ms → scheduled_pause_after_ms for playback.
 *
 * Does NOT absorb phase-budget slack into silence (that caused 60–230s
 * dead-air gaps when voiced audio was shorter than the server-owned budget).
 * Respects intended pauses, shrinks them only when the remaining budget is
 * tight, and hard-caps every scheduled pause.
 */
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
    if (segments.length === 0) continue;

    const budgetSec = input.phaseBudgetSec[phase] ?? 0;
    const voicedSec = segments.reduce((sum, s) => sum + s.actual_duration_sec, 0);
    const remainingMs = Math.max(0, Math.round(budgetSec * 1000 - voicedSec * 1000));

    if (budgetSec > 0 && voicedSec > budgetSec * 1.02) {
      overBudgetPhases.push(phase);
      for (const s of segments) {
        s.scheduled_pause_after_ms = 0;
        reconciled.push(s);
      }
      continue;
    }

    const intended = segments.map((s) =>
      Math.min(Math.max(0, Math.round(s.pause_after_ms)), MAX_SCHEDULED_PAUSE_MS),
    );
    const intendedTotal = intended.reduce((sum, ms) => sum + ms, 0);

    if (intendedTotal === 0) {
      for (const s of segments) {
        s.scheduled_pause_after_ms = 0;
        reconciled.push(s);
      }
      continue;
    }

    if (intendedTotal <= remainingMs) {
      // Use intended pauses as-is — leave budget slack unused (no dead-air padding).
      for (let i = 0; i < segments.length; i += 1) {
        segments[i]!.scheduled_pause_after_ms = intended[i]!;
        reconciled.push(segments[i]!);
      }
      continue;
    }

    // Shrink proportionally so voiced + pauses fit remaining; never inflate.
    const scale = remainingMs / intendedTotal;
    let assigned = 0;
    for (let i = 0; i < segments.length; i += 1) {
      if (i === segments.length - 1) {
        segments[i]!.scheduled_pause_after_ms = Math.max(0, remainingMs - assigned);
      } else {
        const ms = Math.max(0, Math.round(intended[i]! * scale));
        segments[i]!.scheduled_pause_after_ms = ms;
        assigned += ms;
      }
      reconciled.push(segments[i]!);
    }
  }

  return { segments: reconciled, overBudgetPhases };
}
