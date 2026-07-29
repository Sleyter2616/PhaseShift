import { describe, expect, it } from "vitest";
import {
  BOOKEND_END,
  BOOKEND_START,
  buildCountedSequence,
  buildPhaseBudget,
  buildSessionSkeleton,
  distributeThetaTime,
  LENGTHS,
  selectableMiddleCount,
  STEP_WEIGHTS,
  THETA_PER_STEP_FLOOR_SEC,
  validateStepSelection,
  SkeletonValidationError,
} from "./skeleton";

describe("LENGTHS ladder", () => {
  it("retires 40 and exposes 10/15/30/45", () => {
    expect(LENGTHS).toEqual([10, 15, 30, 45]);
    expect(LENGTHS).not.toContain(40);
  });
});

describe("selectableMiddleCount", () => {
  it("maps length to middle-step allowance (full arc at ≥30)", () => {
    expect(selectableMiddleCount(10)).toBe(1);
    expect(selectableMiddleCount(15)).toBe(2);
    expect(selectableMiddleCount(30)).toBe(10);
    expect(selectableMiddleCount(45)).toBe(10);
  });

  it("rejects unknown lengths", () => {
    expect(() => selectableMiddleCount(40)).toThrow(SkeletonValidationError);
  });
});

describe("validateStepSelection", () => {
  it("returns bookended contiguous full list", () => {
    expect(validateStepSelection(10, 5, 1)).toEqual([1, 5, 12]);
    expect(validateStepSelection(15, 4, 2)).toEqual([1, 4, 5, 12]);
    expect(validateStepSelection(30, 2, 10)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(validateStepSelection(45, 2, 10)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("rejects wrong middle count for length", () => {
    expect(() => validateStepSelection(10, 2, 2)).toThrow(/middle_count/);
  });

  it("rejects out-of-bounds middle start", () => {
    expect(() => validateStepSelection(10, 1, 1)).toThrow(/out of bounds/);
    expect(() => validateStepSelection(10, 12, 1)).toThrow(/out of bounds/);
  });

  it("rejects selection that overflows past step 11", () => {
    expect(() => validateStepSelection(30, 7, 10)).toThrow(/exceeds/);
  });

  it("always bookends with 1 and 12", () => {
    for (const length of LENGTHS) {
      const count = selectableMiddleCount(length);
      const steps = validateStepSelection(length, 2, count);
      expect(steps[0]).toBe(BOOKEND_START);
      expect(steps.at(-1)).toBe(BOOKEND_END);
      expect(steps.length).toBe(count + 2);
    }
  });
});

describe("buildPhaseBudget", () => {
  it("sums exactly to lengthMin*60 for all lengths with matching steps", () => {
    for (const length of LENGTHS) {
      const count = selectableMiddleCount(length);
      const steps = validateStepSelection(length, 2, count);
      const budget = buildPhaseBudget(length, steps, "sitting");
      const sum =
        budget.beta_sec + budget.alpha_sec + budget.theta_sec + budget.gamma_sec;
      expect(sum).toBe(length * 60);
    }
  });

  it("sets beta=0 at 10min and positive thereafter", () => {
    const steps10 = validateStepSelection(10, 2, 1);
    expect(buildPhaseBudget(10, steps10).beta_sec).toBe(0);

    for (const length of [15, 30, 45] as const) {
      const steps = validateStepSelection(length, 2, selectableMiddleCount(length));
      expect(buildPhaseBudget(length, steps).beta_sec).toBeGreaterThan(0);
    }
  });

  it("respects alpha/gamma floors and theta per-step floor", () => {
    for (const length of LENGTHS) {
      const steps = validateStepSelection(length, 2, selectableMiddleCount(length));
      const budget = buildPhaseBudget(length, steps);
      expect(budget.alpha_sec).toBeGreaterThanOrEqual(150);
      expect(budget.gamma_sec).toBeGreaterThanOrEqual(120);
      expect(budget.theta_sec).toBeGreaterThan(0);
      expect(budget.theta_sec).toBeGreaterThanOrEqual(
        steps.length * THETA_PER_STEP_FLOOR_SEC,
      );
    }
  });

  it("passes posture through unchanged", () => {
    const steps = validateStepSelection(15, 3, 2);
    expect(buildPhaseBudget(15, steps, "lying").posture).toBe("lying");
    expect(buildPhaseBudget(15, steps, "sitting").posture).toBe("sitting");
  });

  it("scales gamma from ~3min at 30 to ~5.5min at 45", () => {
    const b10 = buildPhaseBudget(10, validateStepSelection(10, 2, 1));
    const b30 = buildPhaseBudget(30, validateStepSelection(30, 2, 10));
    const b45 = buildPhaseBudget(45, validateStepSelection(45, 2, 10));
    expect(b30.gamma_sec).toBe(180);
    expect(b45.gamma_sec).toBe(330);
    expect(b45.gamma_sec).toBeGreaterThan(b30.gamma_sec);
    expect(b45.gamma_sec).toBeGreaterThan(b10.gamma_sec);
  });
});

describe("distributeThetaTime", () => {
  it("renormalizes weights so targets sum to theta_sec", () => {
    for (const length of LENGTHS) {
      const steps = validateStepSelection(length, 2, selectableMiddleCount(length));
      const { theta_sec } = buildPhaseBudget(length, steps);
      const timed = distributeThetaTime(theta_sec, steps);
      expect(timed.reduce((a, t) => a + t.target_sec, 0)).toBe(theta_sec);
      expect(timed.map((t) => t.step)).toEqual(steps);
      for (const t of timed) {
        expect(t.target_sec).toBeGreaterThanOrEqual(THETA_PER_STEP_FLOOR_SEC);
      }
    }
  });

  it("gives Visualize the heaviest share among selected steps", () => {
    const steps = validateStepSelection(45, 2, 10);
    const { theta_sec } = buildPhaseBudget(45, steps);
    const timed = distributeThetaTime(theta_sec, steps);
    const visualize = timed.find((t) => t.step === 1)!;
    for (const t of timed) {
      if (t.step === 1) continue;
      expect(visualize.target_sec).toBeGreaterThanOrEqual(t.target_sec);
    }
    expect(STEP_WEIGHTS[1]).toBe(20);
  });

  it("renormalizes over a subset (10-min single middle)", () => {
    const steps = [1, 6, 12];
    const timed = distributeThetaTime(330, steps);
    expect(timed).toHaveLength(3);
    expect(timed.reduce((a, t) => a + t.target_sec, 0)).toBe(330);
  });
});

describe("buildCountedSequence", () => {
  it("uses fixed 4/2/8/2 breath cycles fit into the budget", () => {
    const seq = buildCountedSequence("breath", 4, 60);
    expect(seq.count).toBe(3); // floor(60/16)=3
    expect(seq.total_sec).toBe(48);
    expect(seq.beats.filter((b) => b.kind === "inhale").every((b) => b.sec === 4)).toBe(true);
    expect(seq.beats.filter((b) => b.kind === "hold").every((b) => b.sec === 2)).toBe(true);
    expect(seq.beats.filter((b) => b.kind === "exhale").every((b) => b.sec === 8)).toBe(true);
    expect(seq.beats.filter((b) => b.kind === "pause").every((b) => b.sec === 2)).toBe(true);
    expect(seq.beats.reduce((a, b) => a + b.sec, 0)).toBe(48);
  });

  it("includes pauses between countdown counts", () => {
    const seq = buildCountedSequence("countdown", 10, 40);
    expect(seq.beats.some((b) => b.kind === "pause")).toBe(true);
    expect(seq.beats.filter((b) => b.kind === "count")).toHaveLength(10);
    expect(seq.beats.reduce((a, b) => a + b.sec, 0)).toBe(40);
    const counts = seq.beats.filter((b) => b.kind === "count") as Array<{
      kind: "count";
      n: number;
    }>;
    expect(counts.map((c) => c.n)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("builds countup and energizing breath with breaks", () => {
    const up = buildCountedSequence("countup", 5, 25);
    expect(up.beats.some((b) => b.kind === "pause")).toBe(true);
    expect(up.beats.reduce((a, b) => a + b.sec, 0)).toBe(25);

    const energy = buildCountedSequence("energizing_breath", 3, 45);
    expect(energy.beats.some((b) => b.kind === "hold")).toBe(true);
    expect(energy.beats.some((b) => b.kind === "pause")).toBe(true);
    expect(energy.beats.reduce((a, b) => a + b.sec, 0)).toBe(45);
  });
});

describe("buildSessionSkeleton defaults", () => {
  it("defaults to 45 / full steps / sitting", () => {
    const skeleton = buildSessionSkeleton({});
    expect(skeleton.length_min).toBe(45);
    expect(skeleton.steps).toHaveLength(12);
    expect(skeleton.posture).toBe("sitting");
    expect(
      skeleton.phase_budget.beta_sec +
        skeleton.phase_budget.alpha_sec +
        skeleton.phase_budget.theta_sec +
        skeleton.phase_budget.gamma_sec,
    ).toBe(2700);
  });
});

describe("v0.5-1.6 length-ladder calibration", () => {
  it("runs the full 12-step arc at both 30 and 45", () => {
    const s30 = buildSessionSkeleton({ length_min: 30 });
    const s45 = buildSessionSkeleton({ length_min: 45 });
    expect(s30.steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s45.steps).toEqual(s30.steps);
  });

  it("keeps 30-min theta at standard density (no padding inflation)", () => {
    const s30 = buildSessionSkeleton({ length_min: 30 });
    expect(s30.depth.density_factor).toBe(1);
    expect(s30.phase_budget.gamma_sec).toBe(180);
    // Natural full-arc theta: remainder after beta/alpha/gamma — not inflated.
    expect(s30.phase_budget.theta_sec).toBe(1260);
    const avgSec =
      s30.theta_steps.reduce((a, t) => a + t.target_sec, 0) / s30.theta_steps.length;
    expect(avgSec).toBeCloseTo(105, 0);
    // Word targets match standard pacing × seconds (no density multiplier on words).
    for (const step of s30.theta_steps) {
      expect(step.target_words).toBe(Math.round((105 * step.target_sec) / 60));
    }
  });

  it("gives 45-min meaningfully higher per-step word budgets than 30", () => {
    const s30 = buildSessionSkeleton({ length_min: 30 });
    const s45 = buildSessionSkeleton({ length_min: 45 });
    expect(s45.depth.density_factor).toBe(1.5);
    expect(s45.phase_budget.gamma_sec).toBeGreaterThan(s30.phase_budget.gamma_sec);
    expect(s45.phase_budget.gamma_sec).toBe(330);

    const avgWords30 =
      s30.theta_steps.reduce((a, t) => a + t.target_words, 0) / s30.theta_steps.length;
    const avgWords45 =
      s45.theta_steps.reduce((a, t) => a + t.target_words, 0) / s45.theta_steps.length;
    // ~40–50%+ more words/step via larger per-step seconds at same pacing.
    expect(avgWords45 / avgWords30).toBeGreaterThanOrEqual(1.4);
    expect(avgWords45 / avgWords30).toBeLessThanOrEqual(1.6);
  });

  it("plans more reflective pause slots at 45 than at 30", () => {
    const s30 = buildSessionSkeleton({ length_min: 30 });
    const s45 = buildSessionSkeleton({ length_min: 45 });
    expect(s30.depth.reflective_pauses.within_step_slots).toBe(0);
    expect(s45.depth.reflective_pauses.within_step_slots).toBe(12);
    expect(
      s45.depth.reflective_pauses.between_step_slots +
        s45.depth.reflective_pauses.within_step_slots,
    ).toBeGreaterThan(
      s30.depth.reflective_pauses.between_step_slots +
        s30.depth.reflective_pauses.within_step_slots,
    );
  });

  it("keeps all length totals within ~10% of the label", () => {
    for (const length of LENGTHS) {
      const skeleton = buildSessionSkeleton({ length_min: length });
      const total =
        skeleton.phase_budget.beta_sec +
        skeleton.phase_budget.alpha_sec +
        skeleton.phase_budget.theta_sec +
        skeleton.phase_budget.gamma_sec;
      const labelSec = length * 60;
      expect(total).toBe(labelSec);
      expect(Math.abs(total - labelSec) / labelSec).toBeLessThanOrEqual(0.1);
    }
  });
});
