/**
 * Server-owned compiler skeleton — deterministic, no network/LLM.
 * Phase budgets, step selection, theta distribution, counted-sequence timing.
 */

export const LENGTHS = [10, 15, 30, 45] as const;
export type SessionLengthMin = (typeof LENGTHS)[number];

export type Posture = "sitting" | "lying";

export const BOOKEND_START = 1;
export const BOOKEND_END = 12;
export const MIDDLE_STEP_MIN = 2;
export const MIDDLE_STEP_MAX = 11;

/** Minimum theta seconds allocated per selected step. */
export const THETA_PER_STEP_FLOOR_SEC = 60;

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

const MIDDLE_COUNT_BY_LENGTH: Record<SessionLengthMin, number> = {
  10: 1,
  15: 2,
  30: 6,
  45: 10,
};

const BETA_SEC_BY_LENGTH: Record<SessionLengthMin, number> = {
  10: 0,
  15: 60,
  30: 90,
  45: 120,
};

/** Alpha floor ~150s; scales to ~360s at 45. */
const ALPHA_SEC_BY_LENGTH: Record<SessionLengthMin, number> = {
  10: 150,
  15: 180,
  30: 270,
  45: 360,
};

/** Gamma floor ~120s; scales mildly to ~240s at 45. */
const GAMMA_SEC_BY_LENGTH: Record<SessionLengthMin, number> = {
  10: 120,
  15: 140,
  30: 180,
  45: 240,
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
  // Contiguity is implied by arithmetic sequence; assert explicitly.
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
  const beta_sec = BETA_SEC_BY_LENGTH[lengthMin];
  const alpha_sec = ALPHA_SEC_BY_LENGTH[lengthMin];
  const gamma_sec = GAMMA_SEC_BY_LENGTH[lengthMin];
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

  // Enforce per-step floor by borrowing from the heaviest step if needed.
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

  return steps.map((step, i) => ({ step, target_sec: targets[i]! }));
}

/**
 * Server-owned counted-sequence timing with enforced break intervals so
 * pacing cannot be compressed by the model.
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
    // inhale / hold / exhale / pause — pause is the enforced inter-count break
    const cycleTarget = totalSec / count;
    const inhale = Math.max(2, Math.floor(cycleTarget * 0.3));
    const hold = Math.max(1, Math.floor(cycleTarget * 0.1));
    const exhale = Math.max(3, Math.floor(cycleTarget * 0.4));
    const pause = Math.max(1, Math.floor(cycleTarget - inhale - hold - exhale));
    // Adjust last pause so sum matches totalSec exactly
    let used = 0;
    for (let n = 1; n <= count; n += 1) {
      beats.push({ kind: "inhale", sec: inhale });
      beats.push({ kind: "hold", sec: hold });
      beats.push({ kind: "exhale", sec: exhale });
      used += inhale + hold + exhale;
      const remainingCounts = count - n;
      const pauseSec =
        n === count
          ? Math.max(1, totalSec - used)
          : Math.max(1, Math.min(pause, totalSec - used - remainingCounts * (inhale + hold + exhale + 1)));
      beats.push({ kind: "pause", sec: pauseSec });
      used += pauseSec;
    }
  } else if (kind === "countdown" || kind === "countup") {
    // Reserve 1s pause between each pair of counts when totalSec allows.
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
    // energizing_breath: rounds of fast nasal breaths with holds between rounds
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
      beats.push({ kind: "inhale", sec: breathBlock }); // fast-breath block duration
      beats.push({ kind: "hold", sec: hold });
      beats.push({ kind: "pause", sec: pause });
      used += breathBlock + hold + pause;
    }
  }

  const sum = beats.reduce((acc, b) => acc + b.sec, 0);
  if (sum !== totalSec) {
    // Fix drift on the last beat
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
  counted_sequences: {
    alpha_breath: CountedSequence;
    alpha_countdown: CountedSequence;
    gamma_energizing: CountedSequence;
    gamma_countup: CountedSequence;
  };
};

/**
 * Build the full server-owned skeleton for a session.
 * Defaults: length 45, full middle (2..11), sitting.
 */
export function buildSessionSkeleton(input: {
  length_min?: number;
  middle_start?: number;
  middle_count?: number;
  posture?: Posture;
}): SessionSkeleton {
  const length_min = (input.length_min ?? 45) as number;
  if (!isSessionLengthMin(length_min)) {
    throw new SkeletonValidationError(`invalid length_min: ${length_min}`);
  }
  const middle_count = input.middle_count ?? selectableMiddleCount(length_min);
  const middle_start = input.middle_start ?? defaultMiddleStart(length_min);
  const posture = input.posture ?? "sitting";

  const steps = validateStepSelection(length_min, middle_start, middle_count);
  const phase_budget = buildPhaseBudget(length_min, steps, posture);
  const theta_steps = distributeThetaTime(phase_budget.theta_sec, steps);

  // Counted sequences sized from phase budgets (server-owned pacing).
  const alphaBreathSec = Math.max(30, Math.floor(phase_budget.alpha_sec * 0.45));
  const alphaCountdownSec = Math.max(20, Math.floor(phase_budget.alpha_sec * 0.25));
  const gammaEnergizingSec = Math.max(30, Math.floor(phase_budget.gamma_sec * 0.5));
  const gammaCountupSec = Math.max(15, Math.floor(phase_budget.gamma_sec * 0.25));

  return {
    length_min,
    steps,
    posture,
    phase_budget,
    theta_steps,
    counted_sequences: {
      alpha_breath: buildCountedSequence("breath", 6, alphaBreathSec),
      alpha_countdown: buildCountedSequence("countdown", 10, alphaCountdownSec),
      gamma_energizing: buildCountedSequence("energizing_breath", 3, gammaEnergizingSec),
      gamma_countup: buildCountedSequence("countup", 5, gammaCountupSec),
    },
  };
}
