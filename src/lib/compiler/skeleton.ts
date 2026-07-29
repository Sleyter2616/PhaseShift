/**
 * Server-owned compiler skeleton — deterministic, no network/LLM.
 * Phase budgets, step selection, theta distribution, counted-sequence timing.
 *
 * Length ladder (v0.5-1.6): full 12-step arc at ≥30 min. Length past 30 buys
 * DEPTH (sensory density, reflective pauses, extended gamma), not more steps.
 */

export const LENGTHS = [10, 15, 30, 45] as const;
export type SessionLengthMin = (typeof LENGTHS)[number];

export type Posture = "sitting" | "lying";

export const BOOKEND_START = 1;
export const BOOKEND_END = 12;
export const MIDDLE_STEP_MIN = 2;
export const MIDDLE_STEP_MAX = 11;

/** Lengths at/above this run the full 12-step arc (middle 2..11). */
export const FULL_ARC_LENGTH_MIN: SessionLengthMin = 30;

/** Baseline full-arc length: standard density (factor 1.0), ~3 min gamma. */
export const STANDARD_FULL_ARC_MIN: SessionLengthMin = 30;

/** Minimum theta seconds allocated per selected step. */
export const THETA_PER_STEP_FLOOR_SEC = 60;

/** Theta pacing used for word-budget targets exposed to the model. */
export const THETA_PACING_WPM = 105;

/** Modest contemplative pause between (and within) theta steps. */
export const REFLECTIVE_PAUSE_MS = 4_000;

export const STEP_NAMES: Record<number, string> = {
  1: "Visualize",
  2: "Surveil",
  3: "Localization",
  4: "Triangulation",
  5: "Disambiguation",
  6: "Features Extraction",
  7: "Recognition",
  8: "Identify",
  9: "Synchronization",
  10: "Approximation",
  11: "Convergence",
  12: "Closure",
};

/**
 * Relative theta weights (ported from prompt v1). Renormalized over the
 * selected step set so they sum to theta_sec.
 */
export const STEP_WEIGHTS: Record<number, number> = {
  1: 20,
  2: 8,
  3: 6,
  4: 10,
  5: 10,
  6: 10,
  7: 6,
  8: 6,
  9: 10,
  10: 4,
  11: 5,
  12: 5,
};

/**
 * Middle-step count by length. ≥30 → full middle (10) so 30 and 45 both run
 * the complete 12-step arc; shorter lengths use a contiguous subset.
 */
const MIDDLE_COUNT_BY_LENGTH: Record<SessionLengthMin, number> = {
  10: 1,
  15: 2,
  30: 10,
  45: 10,
};

export type PhaseBudget = {
  beta_sec: number;
  alpha_sec: number;
  theta_sec: number;
  gamma_sec: number;
  posture: Posture;
};

export type ThetaStepTiming = {
  step: number;
  target_sec: number;
  /** Words at standard theta pacing for this step's target_sec. */
  target_words: number;
};

export type ReflectivePausePlan = {
  between_step_ms: number;
  within_step_ms: number;
  between_step_slots: number;
  within_step_slots: number;
};

export type DepthCalibration = {
  /** 1.0 at ≤30; ~1.5 at 45 — drives prompt depth, not step count. */
  density_factor: number;
  reflective_pauses: ReflectivePausePlan;
};

export type CountedSequenceKind = "breath" | "countdown" | "countup" | "energizing_breath";

export type CountedBeat =
  | { kind: "inhale"; sec: number }
  | { kind: "hold"; sec: number }
  | { kind: "exhale"; sec: number }
  | { kind: "pause"; sec: number }
  | { kind: "count"; n: number; sec: number };

export type CountedSequence = {
  kind: CountedSequenceKind;
  count: number;
  total_sec: number;
  beats: CountedBeat[];
};

export class SkeletonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkeletonValidationError";
  }
}

export function isSessionLengthMin(value: number): value is SessionLengthMin {
  return (LENGTHS as readonly number[]).includes(value);
}

export function selectableMiddleCount(lengthMin: number): number {
  if (!isSessionLengthMin(lengthMin)) {
    throw new SkeletonValidationError(`invalid length_min: ${lengthMin}`);
  }
  return MIDDLE_COUNT_BY_LENGTH[lengthMin];
}

/**
 * Content density vs the 30-min full-arc baseline.
 * ≤30 → 1.0 (standard); scales linearly to 1.5 at 45 (~50% more words/step room).
 */
export function contentDensityFactor(lengthMin: SessionLengthMin): number {
  if (lengthMin <= STANDARD_FULL_ARC_MIN) return 1;
  return 1 + ((lengthMin - STANDARD_FULL_ARC_MIN) / 15) * 0.5;
}

/**
 * Gamma budget as a function of length: ~3 min at 30, ~5.5 min at 45.
 * Short lengths keep compact exit floors.
 */
export function gammaSecForLength(lengthMin: SessionLengthMin): number {
  if (lengthMin === 10) return 120;
  if (lengthMin === 15) return 140;
  const t = Math.max(0, (lengthMin - STANDARD_FULL_ARC_MIN) / 15);
  return Math.round(180 + t * (330 - 180));
}

export function betaSecForLength(lengthMin: SessionLengthMin): number {
  if (lengthMin === 10) return 0;
  if (lengthMin === 15) return 60;
  if (lengthMin === 30) return 90;
  return 120;
}

export function alphaSecForLength(lengthMin: SessionLengthMin): number {
  if (lengthMin === 10) return 150;
  if (lengthMin === 15) return 180;
  if (lengthMin === 30) return 270;
  return 360;
}

/**
 * Reflective pause plan: more slots at depth lengths (within-step dwelling),
 * each slot capped by REFLECTIVE_PAUSE_MS (≤ global scheduled-pause cap).
 */
export function thetaReflectivePausePlan(
  lengthMin: SessionLengthMin,
  stepCount: number,
): ReflectivePausePlan {
  const between = Math.max(0, stepCount - 1);
  const density = contentDensityFactor(lengthMin);
  const depth = density - 1; // 0 at ≤30, 0.5 at 45
  return {
    between_step_ms: REFLECTIVE_PAUSE_MS,
    within_step_ms: depth > 0 ? REFLECTIVE_PAUSE_MS : 0,
    between_step_slots: between,
    // At 45 (depth 0.5): one within-step dwell slot per step.
    within_step_slots: depth > 0 ? Math.round(stepCount * (depth / 0.5)) : 0,
  };
}

export function buildDepthCalibration(
  lengthMin: SessionLengthMin,
  stepCount: number,
): DepthCalibration {
  return {
    density_factor: contentDensityFactor(lengthMin),
    reflective_pauses: thetaReflectivePausePlan(lengthMin, stepCount),
  };
}

export function thetaWordBudget(targetSec: number, pacingWpm = THETA_PACING_WPM): number {
  return Math.round((pacingWpm * targetSec) / 60);
}

/**
 * Validates contiguous middle selection within 2..11 matching the length
 * allowance. Returns ordered full step list [1, ...middle..., 12].
 */
export function validateStepSelection(
  lengthMin: number,
  middleStart: number,
  middleCount: number,
): number[] {
  if (!isSessionLengthMin(lengthMin)) {
    throw new SkeletonValidationError(`invalid length_min: ${lengthMin}`);
  }
  const allowed = MIDDLE_COUNT_BY_LENGTH[lengthMin];
  if (middleCount !== allowed) {
    throw new SkeletonValidationError(
      `middle_count ${middleCount} does not match length ${lengthMin} (expected ${allowed})`,
    );
  }
  if (!Number.isInteger(middleStart) || !Number.isInteger(middleCount)) {
    throw new SkeletonValidationError("middle_start and middle_count must be integers");
  }
  if (middleStart < MIDDLE_STEP_MIN || middleStart > MIDDLE_STEP_MAX) {
    throw new SkeletonValidationError(
      `middle_start ${middleStart} out of bounds (${MIDDLE_STEP_MIN}..${MIDDLE_STEP_MAX})`,
    );
  }
  const middleEnd = middleStart + middleCount - 1;
  if (middleEnd > MIDDLE_STEP_MAX) {
    throw new SkeletonValidationError(
      `middle selection ${middleStart}..${middleEnd} exceeds ${MIDDLE_STEP_MAX}`,
    );
  }

  const middle = Array.from({ length: middleCount }, (_, i) => middleStart + i);
  for (let i = 1; i < middle.length; i += 1) {
    if (middle[i]! !== middle[i - 1]! + 1) {
      throw new SkeletonValidationError("middle steps must be contiguous");
    }
  }

  return [BOOKEND_START, ...middle, BOOKEND_END];
}

/** Default middle selection: earliest contiguous block starting at step 2. */
export function defaultMiddleStart(lengthMin: SessionLengthMin): number {
  void lengthMin;
  return MIDDLE_STEP_MIN;
}

export function buildPhaseBudget(
  lengthMin: number,
  steps: number[],
  posture: Posture = "sitting",
): PhaseBudget {
  if (!isSessionLengthMin(lengthMin)) {
    throw new SkeletonValidationError(`invalid length_min: ${lengthMin}`);
  }
  if (steps.length < 2 || steps[0] !== BOOKEND_START || steps.at(-1) !== BOOKEND_END) {
    throw new SkeletonValidationError("steps must be bookended by 1 and 12");
  }

  const totalSec = lengthMin * 60;
  const beta_sec = betaSecForLength(lengthMin);
  const alpha_sec = alphaSecForLength(lengthMin);
  const gamma_sec = gammaSecForLength(lengthMin);
  const theta_sec = totalSec - beta_sec - alpha_sec - gamma_sec;

  if (theta_sec <= 0) {
    throw new SkeletonValidationError(`theta_sec must be positive; got ${theta_sec}`);
  }

  const minTheta = steps.length * THETA_PER_STEP_FLOOR_SEC;
  if (theta_sec < minTheta) {
    throw new SkeletonValidationError(
      `theta_sec ${theta_sec} below per-step floor (${minTheta} for ${steps.length} steps)`,
    );
  }

  const sum = beta_sec + alpha_sec + theta_sec + gamma_sec;
  if (sum !== totalSec) {
    throw new SkeletonValidationError(`phase budget sum ${sum} !== ${totalSec}`);
  }

  return { beta_sec, alpha_sec, theta_sec, gamma_sec, posture };
}

/**
 * Split theta_sec across selected steps using relative weights, renormalized
 * so targets sum exactly to theta_sec (largest-remainder method).
 */
export function distributeThetaTime(theta_sec: number, steps: number[]): ThetaStepTiming[] {
  if (!Number.isInteger(theta_sec) || theta_sec <= 0) {
    throw new SkeletonValidationError(`invalid theta_sec: ${theta_sec}`);
  }
  if (steps.length === 0) {
    throw new SkeletonValidationError("steps must be non-empty");
  }

  const weights = steps.map((step) => {
    const w = STEP_WEIGHTS[step];
    if (w == null || w <= 0) {
      throw new SkeletonValidationError(`missing weight for step ${step}`);
    }
    return w;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const raw = weights.map((w) => (theta_sec * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = theta_sec - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  const targets = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    targets[i]! += 1;
    remainder -= 1;
  }

  for (let i = 0; i < targets.length; i += 1) {
    if (targets[i]! < THETA_PER_STEP_FLOOR_SEC) {
      const deficit = THETA_PER_STEP_FLOOR_SEC - targets[i]!;
      const donor = targets.indexOf(Math.max(...targets));
      if (donor === i || targets[donor]! - deficit < THETA_PER_STEP_FLOOR_SEC) {
        throw new SkeletonValidationError(
          `cannot enforce ${THETA_PER_STEP_FLOOR_SEC}s floor for step ${steps[i]}`,
        );
      }
      targets[donor]! -= deficit;
      targets[i]! += deficit;
    }
  }

  const sum = targets.reduce((a, b) => a + b, 0);
  if (sum !== theta_sec) {
    throw new SkeletonValidationError(`theta distribution sum ${sum} !== ${theta_sec}`);
  }

  return steps.map((step, i) => ({
    step,
    target_sec: targets[i]!,
    target_words: thetaWordBudget(targets[i]!),
  }));
}

/** Fixed breath ratio: inhale 4s / hold 2s / exhale 8s / pause 2s (per cycle). */
export const BREATH_INHALE_SEC = 4;
export const BREATH_HOLD_SEC = 2;
export const BREATH_EXHALE_SEC = 8;
export const BREATH_PAUSE_SEC = 2;
export const BREATH_CYCLE_SEC =
  BREATH_INHALE_SEC + BREATH_HOLD_SEC + BREATH_EXHALE_SEC + BREATH_PAUSE_SEC;

export const BREATH_CUES = {
  inhale: "Breathe in.",
  hold: "Hold.",
  exhale: "Breathe out.",
} as const;

/**
 * Server-owned counted-sequence timing with enforced break intervals so
 * pacing cannot be compressed by the model.
 *
 * Breath uses a fixed 4/2/8/2 cycle; cycle count is fit into totalSec.
 */
export function buildCountedSequence(
  kind: CountedSequenceKind,
  count: number,
  totalSec: number,
): CountedSequence {
  if (!Number.isInteger(count) || count <= 0) {
    throw new SkeletonValidationError(`invalid count: ${count}`);
  }
  if (!Number.isInteger(totalSec) || totalSec <= 0) {
    throw new SkeletonValidationError(`invalid totalSec: ${totalSec}`);
  }

  const beats: CountedBeat[] = [];

  if (kind === "breath") {
    const maxCycles = Math.max(1, Math.floor(totalSec / BREATH_CYCLE_SEC));
    const cycles = Math.min(count, maxCycles);
    for (let n = 1; n <= cycles; n += 1) {
      beats.push({ kind: "inhale", sec: BREATH_INHALE_SEC });
      beats.push({ kind: "hold", sec: BREATH_HOLD_SEC });
      beats.push({ kind: "exhale", sec: BREATH_EXHALE_SEC });
      beats.push({ kind: "pause", sec: BREATH_PAUSE_SEC });
    }
    const total_sec = cycles * BREATH_CYCLE_SEC;
    return {
      kind,
      count: cycles,
      total_sec,
      beats,
    };
  }

  if (kind === "countdown" || kind === "countup") {
    const pauseSlots = Math.max(0, count - 1);
    const pauseEach = totalSec >= count + pauseSlots ? 1 : 0;
    const speakPool = totalSec - pauseEach * pauseSlots;
    const base = Math.floor(speakPool / count);
    let remainder = speakPool - base * count;
    for (let i = 0; i < count; i += 1) {
      const n = kind === "countdown" ? count - i : i + 1;
      const sec = Math.max(1, base + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
      beats.push({ kind: "count", n, sec });
      if (i < count - 1 && pauseEach > 0) {
        beats.push({ kind: "pause", sec: pauseEach });
      }
    }
  } else {
    const rounds = count;
    const perRound = Math.floor(totalSec / rounds);
    let used = 0;
    for (let r = 1; r <= rounds; r += 1) {
      const breathBlock = Math.max(4, Math.floor(perRound * 0.7));
      const hold = Math.max(2, Math.floor(perRound * 0.2));
      const pause =
        r === rounds
          ? Math.max(1, totalSec - used - breathBlock - hold)
          : Math.max(1, perRound - breathBlock - hold);
      beats.push({ kind: "inhale", sec: breathBlock });
      beats.push({ kind: "hold", sec: hold });
      beats.push({ kind: "pause", sec: pause });
      used += breathBlock + hold + pause;
    }
  }

  const sum = beats.reduce((acc, b) => acc + b.sec, 0);
  if (sum !== totalSec) {
    const last = beats.at(-1);
    if (last) {
      last.sec += totalSec - sum;
      if (last.sec < 1) {
        throw new SkeletonValidationError(
          `counted sequence timing could not sum to ${totalSec}s (got ${sum})`,
        );
      }
    }
  }

  const hasBreak = beats.some((b) => b.kind === "pause" || b.kind === "hold");
  if (!hasBreak) {
    throw new SkeletonValidationError("counted sequence must include enforced breaks");
  }

  return {
    kind,
    count,
    total_sec: totalSec,
    beats,
  };
}

export type SessionSkeleton = {
  length_min: SessionLengthMin;
  steps: number[];
  posture: Posture;
  phase_budget: PhaseBudget;
  theta_steps: ThetaStepTiming[];
  depth: DepthCalibration;
  counted_sequences: {
    alpha_breath: CountedSequence;
    alpha_countdown: CountedSequence;
    gamma_energizing: CountedSequence;
    gamma_countup: CountedSequence;
  };
};

/**
 * Build the full server-owned skeleton for a session.
 * Defaults: length 30 (full-arc baseline), full middle (2..11), sitting.
 */
export function buildSessionSkeleton(input: {
  length_min?: number;
  middle_start?: number;
  middle_count?: number;
  posture?: Posture;
}): SessionSkeleton {
  const length_min = (input.length_min ?? 30) as number;
  if (!isSessionLengthMin(length_min)) {
    throw new SkeletonValidationError(`invalid length_min: ${length_min}`);
  }
  const middle_count = input.middle_count ?? selectableMiddleCount(length_min);
  const middle_start = input.middle_start ?? defaultMiddleStart(length_min);
  const posture = input.posture ?? "sitting";

  const steps = validateStepSelection(length_min, middle_start, middle_count);
  const phase_budget = buildPhaseBudget(length_min, steps, posture);
  const theta_steps = distributeThetaTime(phase_budget.theta_sec, steps);
  const depth = buildDepthCalibration(length_min, steps.length);

  const alphaBreathSec = Math.max(BREATH_CYCLE_SEC, Math.floor(phase_budget.alpha_sec * 0.45));
  const alphaCountdownSec = Math.max(20, Math.floor(phase_budget.alpha_sec * 0.25));
  const gammaEnergizingSec = Math.max(30, Math.floor(phase_budget.gamma_sec * 0.5));
  const gammaCountupSec = Math.max(15, Math.floor(phase_budget.gamma_sec * 0.25));
  const alphaBreathCycles = Math.max(1, Math.floor(alphaBreathSec / BREATH_CYCLE_SEC));

  return {
    length_min,
    steps,
    posture,
    phase_budget,
    theta_steps,
    depth,
    counted_sequences: {
      alpha_breath: buildCountedSequence("breath", alphaBreathCycles, alphaBreathSec),
      alpha_countdown: buildCountedSequence("countdown", 10, alphaCountdownSec),
      gamma_energizing: buildCountedSequence("energizing_breath", 3, gammaEnergizingSec),
      gamma_countup: buildCountedSequence("countup", 5, gammaCountupSec),
    },
  };
}
