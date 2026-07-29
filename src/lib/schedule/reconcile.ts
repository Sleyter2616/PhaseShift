export const PHASES = ["beta", "alpha", "theta", "gamma"] as const;
export type PhaseKey = (typeof PHASES)[number];

/**
 * Hard cap for beta/alpha/gamma (and for theta *intended* pauses before
 * length-dwelling fill). Counted-sequence silence (countdown gaps) needs up to 10s.
 */
export const MAX_SCHEDULED_PAUSE_MS = 10_000;

/** Contemplative dwelling pauses in theta only (length reconciliation). */
export const MAX_THETA_DWELLING_PAUSE_MS = 30_000;

/** Final wall clock must land within this fraction of the label. */
export const LENGTH_TOLERANCE_RATIO = 0.03;

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

export interface LengthReconcileResult extends ReconcileResult {
  targetTotalSec: number;
  totalSec: number;
  withinTolerance: boolean;
}

function pauseCapForPhase(phase: PhaseKey): number {
  return phase === "theta" ? MAX_THETA_DWELLING_PAUSE_MS : MAX_SCHEDULED_PAUSE_MS;
}

function wallSec(segments: ReadonlyArray<ReconcileSegment>): number {
  return segments.reduce(
    (sum, s) => sum + s.actual_duration_sec + (s.scheduled_pause_after_ms ?? 0) / 1000,
    0,
  );
}

function applyIntendedPauses(segments: ReconcileSegment[]): ReconcileSegment[] {
  return segments.map((segment) => ({
    ...segment,
    // Intended pauses use the tight 10s cap; theta dwelling fill may raise later.
    scheduled_pause_after_ms: Math.min(
      Math.max(0, Math.round(segment.pause_after_ms)),
      MAX_SCHEDULED_PAUSE_MS,
    ),
  }));
}

function flagOverBudgetPhases(
  segments: ReadonlyArray<ReconcileSegment>,
  phaseBudgetSec: Record<PhaseKey, number>,
): PhaseKey[] {
  const over: PhaseKey[] = [];
  for (const phase of PHASES) {
    const budgetSec = phaseBudgetSec[phase] ?? 0;
    if (budgetSec <= 0) continue;
    const voicedSec = segments
      .filter((s) => s.phase === phase)
      .reduce((sum, s) => sum + s.actual_duration_sec, 0);
    if (voicedSec > budgetSec * 1.02) over.push(phase);
  }
  return over;
}

function distributeThetaDwelling(
  segments: ReconcileSegment[],
  shortfallMs: number,
): void {
  if (shortfallMs <= 0) return;
  const thetaIdx = segments
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.phase === "theta");
  if (thetaIdx.length === 0) return;

  const headroom = thetaIdx.map(({ s }) =>
    Math.max(0, MAX_THETA_DWELLING_PAUSE_MS - (s.scheduled_pause_after_ms ?? 0)),
  );
  const totalHeadroom = headroom.reduce((a, b) => a + b, 0);
  if (totalHeadroom <= 0) return;

  const fill = Math.min(shortfallMs, totalHeadroom);
  let assigned = 0;
  for (let k = 0; k < thetaIdx.length; k += 1) {
    const { i } = thetaIdx[k]!;
    const share =
      k === thetaIdx.length - 1
        ? fill - assigned
        : Math.floor((fill * headroom[k]!) / totalHeadroom);
    const add = Math.min(headroom[k]!, Math.max(0, share));
    segments[i]!.scheduled_pause_after_ms = (segments[i]!.scheduled_pause_after_ms ?? 0) + add;
    assigned += add;
  }

  // Fix any remaining ms into slots that still have headroom (round-robin).
  let leftover = fill - assigned;
  let guard = 0;
  while (leftover > 0 && guard < thetaIdx.length * 3) {
    let progressed = false;
    for (const { i } of thetaIdx) {
      if (leftover <= 0) break;
      const cur = segments[i]!.scheduled_pause_after_ms ?? 0;
      if (cur >= MAX_THETA_DWELLING_PAUSE_MS) continue;
      segments[i]!.scheduled_pause_after_ms = cur + 1;
      leftover -= 1;
      progressed = true;
    }
    if (!progressed) break;
    guard += 1;
  }
}

function trimSmallestPauses(segments: ReconcileSegment[], overageMs: number): void {
  let remaining = overageMs;
  while (remaining > 0) {
    let bestIdx = -1;
    let bestPause = Number.POSITIVE_INFINITY;
    for (let i = 0; i < segments.length; i += 1) {
      const pause = segments[i]!.scheduled_pause_after_ms ?? 0;
      if (pause > 0 && pause < bestPause) {
        bestPause = pause;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const cur = segments[bestIdx]!.scheduled_pause_after_ms ?? 0;
    const cut = Math.min(cur, remaining);
    segments[bestIdx]!.scheduled_pause_after_ms = cur - cut;
    remaining -= cut;
  }
}

/**
 * Map compiler pause_after_ms → scheduled_pause_after_ms for playback,
 * then adjust so speech + pauses land within tolerance of targetTotalSec.
 *
 * Shortfall → theta dwelling silence only (spread across many slots, each
 * ≤ MAX_THETA_DWELLING_PAUSE_MS). Overage → trim smallest pauses first.
 * beta/alpha/gamma never exceed MAX_SCHEDULED_PAUSE_MS (~10s).
 */
export function reconcileLengthToTarget(input: {
  targetTotalSec: number;
  phaseBudgetSec: Record<PhaseKey, number>;
  segments: ReconcileSegment[];
}): LengthReconcileResult {
  const withIntended = applyIntendedPauses(input.segments.map((s) => ({ ...s })));

  // If a phase is wildly over-voiced, zero its pauses (legacy safety).
  const overBudgetPhases = flagOverBudgetPhases(withIntended, input.phaseBudgetSec);
  for (const phase of overBudgetPhases) {
    for (const seg of withIntended) {
      if (seg.phase === phase) seg.scheduled_pause_after_ms = 0;
    }
  }

  const target = input.targetTotalSec;
  const lo = target * (1 - LENGTH_TOLERANCE_RATIO);
  const hi = target * (1 + LENGTH_TOLERANCE_RATIO);

  let total = wallSec(withIntended);

  if (total < lo) {
    const shortfallMs = Math.max(0, Math.round((target - total) * 1000));
    distributeThetaDwelling(withIntended, shortfallMs);
    total = wallSec(withIntended);
  } else if (total > hi) {
    const overageMs = Math.max(0, Math.round((total - target) * 1000));
    trimSmallestPauses(withIntended, overageMs);
    total = wallSec(withIntended);
  }

  // Enforce per-phase caps after adjustments.
  for (const seg of withIntended) {
    const cap = pauseCapForPhase(seg.phase);
    seg.scheduled_pause_after_ms = Math.min(
      Math.max(0, Math.round(seg.scheduled_pause_after_ms ?? 0)),
      cap,
    );
  }
  total = wallSec(withIntended);

  return {
    segments: withIntended,
    overBudgetPhases,
    targetTotalSec: target,
    totalSec: total,
    withinTolerance: total >= lo && total <= hi,
  };
}

/**
 * Legacy per-phase reconcile (intended pauses, no session-length fill).
 * Prefer reconcileLengthToTarget for generation.
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
      for (let i = 0; i < segments.length; i += 1) {
        segments[i]!.scheduled_pause_after_ms = intended[i]!;
        reconciled.push(segments[i]!);
      }
      continue;
    }

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
