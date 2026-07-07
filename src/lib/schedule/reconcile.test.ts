import { describe, expect, it } from "vitest";
import { reconcilePhaseTiming } from "./reconcile";

describe("reconcilePhaseTiming", () => {
  it("scales pause_after_ms proportionally into scheduled_pause_after_ms", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 10, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        {
          phase: "beta",
          pause_after_ms: 2000,
          actual_duration_sec: 4,
        },
        {
          phase: "beta",
          pause_after_ms: 2000,
          actual_duration_sec: 4,
        },
      ],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    expect(beta[0]?.scheduled_pause_after_ms).toBe(1000);
    expect(beta[1]?.scheduled_pause_after_ms).toBe(1000);
    expect(result.overBudgetPhases).toEqual([]);
  });

  it("uses even-gap fallback when raw pauses are zero", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 10, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 0, actual_duration_sec: 2 },
        { phase: "beta", pause_after_ms: 0, actual_duration_sec: 2 },
        { phase: "beta", pause_after_ms: 0, actual_duration_sec: 2 },
      ],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    expect(beta[0]?.scheduled_pause_after_ms).toBe(2000);
    expect(beta[1]?.scheduled_pause_after_ms).toBe(2000);
    expect(beta[2]?.scheduled_pause_after_ms).toBe(0);
  });

  it("assigns zero scheduled pause to the last segment in a phase", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 0, alpha: 12, theta: 0, gamma: 0 },
      segments: [
        { phase: "alpha", pause_after_ms: 0, actual_duration_sec: 4 },
        { phase: "alpha", pause_after_ms: 0, actual_duration_sec: 4 },
      ],
    });

    const alpha = result.segments.filter((s) => s.phase === "alpha");
    expect(alpha.at(-1)?.scheduled_pause_after_ms).toBe(0);
    expect(alpha[0]?.scheduled_pause_after_ms).toBe(4000);
  });

  it("flags phases where voiced seconds exceed budget by more than 2%", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 10, alpha: 0, theta: 0, gamma: 0 },
      segments: [{ phase: "beta", pause_after_ms: 1000, actual_duration_sec: 11 }],
    });

    expect(result.overBudgetPhases).toContain("beta");
    expect(result.segments[0]?.scheduled_pause_after_ms).toBe(0);
  });

  it("never emits negative scheduled pauses", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 5, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 5000, actual_duration_sec: 6 },
        { phase: "beta", pause_after_ms: 5000, actual_duration_sec: 6 },
      ],
    });

    for (const segment of result.segments) {
      expect(segment.scheduled_pause_after_ms).toBeGreaterThanOrEqual(0);
    }
    expect(result.overBudgetPhases).toContain("beta");
  });
});
