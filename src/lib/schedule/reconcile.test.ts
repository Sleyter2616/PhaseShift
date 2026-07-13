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

  it("distributes fallback silence across all segments including the last", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 10, alpha: 0, theta: 0, gamma: 0 },
      segments: [
        { phase: "beta", pause_after_ms: 0, actual_duration_sec: 2 },
        { phase: "beta", pause_after_ms: 0, actual_duration_sec: 2 },
        { phase: "beta", pause_after_ms: 0, actual_duration_sec: 2 },
      ],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    expect(beta[0]?.scheduled_pause_after_ms).toBe(1333);
    expect(beta[1]?.scheduled_pause_after_ms).toBe(1333);
    expect(beta[2]?.scheduled_pause_after_ms).toBe(1334);

    const totalPauseMs = beta.reduce((sum, s) => sum + (s.scheduled_pause_after_ms ?? 0), 0);
    expect(totalPauseMs).toBe(4000);
  });

  it("closes a single-segment phase exactly with trailing silence on the last segment", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 120, alpha: 0, theta: 0, gamma: 0 },
      segments: [{ phase: "beta", pause_after_ms: 0, actual_duration_sec: 75 }],
    });

    const beta = result.segments.filter((s) => s.phase === "beta");
    expect(beta).toHaveLength(1);
    expect(beta[0]?.scheduled_pause_after_ms).toBe(45_000);

    const voicedSec = 75;
    const pauseSec = (beta[0]?.scheduled_pause_after_ms ?? 0) / 1000;
    expect(voicedSec + pauseSec).toBe(120);
  });

  it("puts fallback rounding drift on the last segment", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 0, alpha: 12, theta: 0, gamma: 0 },
      segments: [
        { phase: "alpha", pause_after_ms: 0, actual_duration_sec: 4 },
        { phase: "alpha", pause_after_ms: 0, actual_duration_sec: 4 },
      ],
    });

    const alpha = result.segments.filter((s) => s.phase === "alpha");
    expect(alpha[0]?.scheduled_pause_after_ms).toBe(2000);
    expect(alpha[1]?.scheduled_pause_after_ms).toBe(2000);

    const totalPauseMs = alpha.reduce((sum, s) => sum + (s.scheduled_pause_after_ms ?? 0), 0);
    expect(totalPauseMs).toBe(4000);
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

  it("fallback emits integers and closes the phase when voiced durations have float dust", () => {
    const actual = 71.48333333;
    const count = 30;
    const voicedSec = actual * count;
    const budgetSec = voicedSec + 27.228;

    const segments = Array.from({ length: count }, () => ({
      phase: "theta" as const,
      pause_after_ms: 0,
      actual_duration_sec: actual,
    }));

    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 0, alpha: 0, theta: budgetSec, gamma: 0 },
      segments,
    });

    const theta = result.segments.filter((s) => s.phase === "theta");
    expect(theta).toHaveLength(count);

    for (const segment of theta) {
      expect(Number.isInteger(segment.scheduled_pause_after_ms)).toBe(true);
      expect(segment.scheduled_pause_after_ms).toBeGreaterThanOrEqual(0);
    }

    const totalPauseMs = theta.reduce((sum, s) => sum + (s.scheduled_pause_after_ms ?? 0), 0);
    const expectedRemainingMs = Math.max(0, Math.round(budgetSec * 1000 - voicedSec * 1000));
    expect(totalPauseMs).toBe(expectedRemainingMs);

    const phaseTotalMs = Math.round(voicedSec * 1000) + totalPauseMs;
    expect(phaseTotalMs).toBe(Math.round(budgetSec * 1000));
  });

  it("scale branch emits integers when voiced durations have float dust", () => {
    const actual = 71.48333333;
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 250, alpha: 0, theta: 0, gamma: 0 },
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
    }

    const voicedSec = beta.reduce((sum, s) => sum + s.actual_duration_sec, 0);
    const pauseMs = beta.reduce((sum, s) => sum + (s.scheduled_pause_after_ms ?? 0), 0);
    expect(Math.round(voicedSec * 1000) + pauseMs).toBe(Math.round(250 * 1000));
  });
});
