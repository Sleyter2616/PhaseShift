import { describe, expect, it } from "vitest";
import {
  LENGTH_TOLERANCE_RATIO,
  MAX_SCHEDULED_PAUSE_MS,
  MAX_THETA_DWELLING_PAUSE_MS,
  reconcileLengthToTarget,
  reconcilePhaseTiming,
} from "./reconcile";
import { LENGTHS, buildSessionSkeleton } from "../compiler/skeleton";

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
    expect(result.overBudgetPhases).toEqual([]);
  });

  it("caps intended pauses at MAX_SCHEDULED_PAUSE_MS", () => {
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
});

describe("reconcileLengthToTarget", () => {
  it("fills a 38-min content shortfall to ~45 via distributed theta dwelling", () => {
    const target = 45 * 60;
    const speechTotal = 38 * 60;
    const thetaCount = 12;
    const otherSpeech = 120;
    const thetaSpeechEach = (speechTotal - otherSpeech) / thetaCount;

    const segments = [
      { phase: "beta" as const, pause_after_ms: 500, actual_duration_sec: 30 },
      { phase: "alpha" as const, pause_after_ms: 2000, actual_duration_sec: 50 },
      ...Array.from({ length: thetaCount }, () => ({
        phase: "theta" as const,
        pause_after_ms: 4000,
        actual_duration_sec: thetaSpeechEach,
      })),
      { phase: "gamma" as const, pause_after_ms: 500, actual_duration_sec: 40 },
    ];

    const result = reconcileLengthToTarget({
      targetTotalSec: target,
      phaseBudgetSec: { beta: 120, alpha: 360, theta: 1890, gamma: 330 },
      segments,
    });

    expect(result.withinTolerance).toBe(true);
    expect(result.totalSec).toBeGreaterThanOrEqual(target * (1 - LENGTH_TOLERANCE_RATIO));
    expect(result.totalSec).toBeLessThanOrEqual(target * (1 + LENGTH_TOLERANCE_RATIO));

    for (const seg of result.segments) {
      if (seg.phase === "theta") {
        expect(seg.scheduled_pause_after_ms ?? 0).toBeLessThanOrEqual(MAX_THETA_DWELLING_PAUSE_MS);
      } else {
        expect(seg.scheduled_pause_after_ms ?? 0).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
      }
    }

    const thetaPauses = result.segments
      .filter((s) => s.phase === "theta")
      .map((s) => s.scheduled_pause_after_ms ?? 0);
    expect(Math.max(...thetaPauses)).toBeLessThanOrEqual(MAX_THETA_DWELLING_PAUSE_MS);
    // Shortfall spread — not dumped into a single slot.
    const raised = thetaPauses.filter((ms) => ms > 4000);
    expect(raised.length).toBeGreaterThan(3);
  });

  it("keeps beta/alpha/gamma pauses tight while theta absorbs shortfall", () => {
    const result = reconcileLengthToTarget({
      targetTotalSec: 900,
      phaseBudgetSec: { beta: 60, alpha: 180, theta: 520, gamma: 140 },
      segments: [
        { phase: "beta", pause_after_ms: 500, actual_duration_sec: 20 },
        { phase: "alpha", pause_after_ms: 8000, actual_duration_sec: 40 },
        { phase: "theta", pause_after_ms: 1000, actual_duration_sec: 100 },
        { phase: "theta", pause_after_ms: 1000, actual_duration_sec: 100 },
        { phase: "theta", pause_after_ms: 1000, actual_duration_sec: 100 },
        { phase: "theta", pause_after_ms: 1000, actual_duration_sec: 100 },
        { phase: "gamma", pause_after_ms: 20_000, actual_duration_sec: 30 },
      ],
    });

    const nonTheta = result.segments.filter((s) => s.phase !== "theta");
    for (const seg of nonTheta) {
      expect(seg.scheduled_pause_after_ms ?? 0).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
    }
    expect(result.segments.find((s) => s.phase === "gamma")?.scheduled_pause_after_ms).toBe(
      MAX_SCHEDULED_PAUSE_MS,
    );
  });

  it("trims a ~46-min wall-clock session to ~45 by cutting smallest pauses", () => {
    const target = 45 * 60;
    // Speech = 44 min; intended pauses add ~3 min → ~47 min wall; trim back.
    const speechSec = 44 * 60;
    const result = reconcileLengthToTarget({
      targetTotalSec: target,
      phaseBudgetSec: { beta: 120, alpha: 360, theta: 1890, gamma: 330 },
      segments: [
        { phase: "beta", pause_after_ms: 5000, actual_duration_sec: 90 },
        { phase: "alpha", pause_after_ms: 8000, actual_duration_sec: 200 },
        { phase: "theta", pause_after_ms: 10_000, actual_duration_sec: 500 },
        { phase: "theta", pause_after_ms: 10_000, actual_duration_sec: 500 },
        { phase: "theta", pause_after_ms: 10_000, actual_duration_sec: 500 },
        { phase: "theta", pause_after_ms: 2000, actual_duration_sec: 400 },
        { phase: "theta", pause_after_ms: 10_000, actual_duration_sec: 300 },
        {
          phase: "gamma",
          pause_after_ms: 8000,
          actual_duration_sec: speechSec - 90 - 200 - 500 - 500 - 500 - 400 - 300,
        },
      ],
    });

    expect(result.withinTolerance).toBe(true);
    expect(result.totalSec).toBeLessThanOrEqual(target * (1 + LENGTH_TOLERANCE_RATIO));
    expect(result.totalSec).toBeGreaterThanOrEqual(target * (1 - LENGTH_TOLERANCE_RATIO));
    const speechSum = result.segments.reduce((s, seg) => s + seg.actual_duration_sec, 0);
    expect(speechSum).toBe(speechSec);
  });

  it.each([...LENGTHS])(
    "lands within 3%% of the %s-min label when content undershoots",
    (lengthMin) => {
      const skeleton = buildSessionSkeleton({ length_min: lengthMin });
      const target = lengthMin * 60;
      const budget = {
        beta: skeleton.phase_budget.beta_sec,
        alpha: skeleton.phase_budget.alpha_sec,
        theta: skeleton.phase_budget.theta_sec,
        gamma: skeleton.phase_budget.gamma_sec,
      };

      // ~88% speech so theta dwelling headroom can close to within 3%.
      const speechPool = target * 0.88;
      const thetaN = Math.max(1, skeleton.steps.length);
      const perTheta = (speechPool * 0.7) / thetaN;
      const segments = [
        ...(budget.beta > 0
          ? [{ phase: "beta" as const, pause_after_ms: 500, actual_duration_sec: speechPool * 0.05 }]
          : []),
        { phase: "alpha" as const, pause_after_ms: 2000, actual_duration_sec: speechPool * 0.1 },
        ...skeleton.steps.map(() => ({
          phase: "theta" as const,
          pause_after_ms: 2000,
          actual_duration_sec: perTheta,
        })),
        { phase: "gamma" as const, pause_after_ms: 500, actual_duration_sec: speechPool * 0.15 },
      ];

      const result = reconcileLengthToTarget({
        targetTotalSec: target,
        phaseBudgetSec: budget,
        segments,
      });

      expect(result.withinTolerance).toBe(true);
      expect(Math.abs(result.totalSec - target) / target).toBeLessThanOrEqual(
        LENGTH_TOLERANCE_RATIO + 1e-6,
      );
    },
  );
});
