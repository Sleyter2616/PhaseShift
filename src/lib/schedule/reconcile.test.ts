import { describe, expect, it } from "vitest";
import { MAX_SCHEDULED_PAUSE_MS, reconcilePhaseTiming } from "./reconcile";

describe("reconcilePhaseTiming", () => {
  it("respects intended pauses without inflating slack", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 120, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 500, actual_duration_sec: 4 },
        { phase: "beta", pause_after_ms: 500, actual_duration_sec: 4 },
      ],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    expect(beta[0]?.scheduled_pause_after_ms).toBe(500);
    expect(beta[1]?.scheduled_pause_after_ms).toBe(500);
    // Slack (~112s) is NOT dumped into pauses.
    expect(result.overBudgetPhases).toEqual([]);
  });

  it("caps every scheduled pause at MAX_SCHEDULED_PAUSE_MS", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 600, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 65_705, actual_duration_sec: 10 },
        { phase: "beta", pause_after_ms: 230_340, actual_duration_sec: 10 },
      ],
    });

    for (const segment of result.segments) {
      expect(segment.scheduled_pause_after_ms).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
      expect(segment.scheduled_pause_after_ms).toBe(MAX_SCHEDULED_PAUSE_MS);
    }
  });

  it("does not invent silence when pause_after_ms is 0", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 120, alpha: 0, theta: 0, gamma: 0 },
      segments: [{ phase: "beta", pause_after_ms: 0, actual_duration_sec: 75 }],
    });

    expect(result.segments[0]?.scheduled_pause_after_ms).toBe(0);
  });

  it("shrinks pauses when intended total exceeds remaining budget", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 10, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 2000, actual_duration_sec: 4 },
        { phase: "beta", pause_after_ms: 2000, actual_duration_sec: 4 },
      ],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    expect(beta[0]?.scheduled_pause_after_ms).toBe(1000);
    expect(beta[1]?.scheduled_pause_after_ms).toBe(1000);
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

  it("emits integers when shrinking with float voiced durations", () => {
    const actual = 71.48333333;
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 220, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 2000, actual_duration_sec: actual },
        { phase: "beta", pause_after_ms: 2000, actual_duration_sec: actual },
        { phase: "beta", pause_after_ms: 2000, actual_duration_sec: actual },
      ],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    for (const segment of beta) {
      expect(Number.isInteger(segment.scheduled_pause_after_ms)).toBe(true);
      expect(segment.scheduled_pause_after_ms).toBeGreaterThanOrEqual(0);
      expect(segment.scheduled_pause_after_ms).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
    }
  });
});
