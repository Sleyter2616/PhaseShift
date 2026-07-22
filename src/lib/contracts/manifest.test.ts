import { describe, expect, it } from "vitest";
import { validateManifest } from "./manifest";

const baseManifest = {
  meta: {
    goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
    total_duration_sec: 1200,
    phase_budget_sec: { beta: 60, alpha: 240, theta: 780, gamma: 120 },
    entrainment_plan: [
      { phase: "beta", hz: 18, glide_to: 10, glide_sec: 45 },
      { phase: "alpha", hz: 10, glide_to: 6, glide_sec: 60 },
      { phase: "theta", hz: 6, glide_to: null },
      { phase: "gamma", hz: 40, glide_sec: 30 },
    ],
  },
  segments: [] as Array<Record<string, unknown>>,
};

function thetaSegment(seq: number, step: number, durationSec: number) {
  return {
    seq,
    phase: "theta",
    step,
    perspective: "first",
    temporal_horizon: "protospective",
    archetype: null,
    pacing_wpm: 105,
    target_duration_sec: durationSec,
    pause_after_ms: 500,
    text: "I hold the scene with steady focus.",
  };
}

describe("validateManifest", () => {
  it("returns ok for a structurally valid minimal manifest", () => {
    const segments = [
      {
        seq: 1,
        phase: "beta",
        step: null,
        pacing_wpm: 130,
        target_duration_sec: 60,
        pause_after_ms: 1000,
        text: "You are seated now.",
      },
      {
        seq: 2,
        phase: "alpha",
        step: null,
        pacing_wpm: 90,
        target_duration_sec: 240,
        pause_after_ms: 1000,
        text: "You breathe slowly.",
      },
      ...Array.from({ length: 12 }, (_, i) => thetaSegment(3 + i, i + 1, 65)),
      {
        seq: 15,
        phase: "gamma",
        step: null,
        pacing_wpm: 150,
        target_duration_sec: 120,
        pause_after_ms: 500,
        text: "You rise with energy.",
      },
    ];

    const result = validateManifest({ ...baseManifest, segments });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
    }
  });

  it("accepts beta-absent sessions when budget is 0", () => {
    const steps = [1, 2, 3, 12];
    const thetaBudget = 400;
    const perStep = thetaBudget / steps.length;
    const segments = [
      {
        seq: 1,
        phase: "alpha",
        step: null,
        pacing_wpm: 90,
        target_duration_sec: 180,
        pause_after_ms: 1000,
        text: "You breathe slowly.",
      },
      ...steps.map((step, i) => thetaSegment(2 + i, step, perStep)),
      {
        seq: 6,
        phase: "gamma",
        step: null,
        pacing_wpm: 150,
        target_duration_sec: 140,
        pause_after_ms: 500,
        text: "You rise with energy.",
      },
    ];

    const result = validateManifest(
      {
        meta: {
          ...baseManifest.meta,
          total_duration_sec: 720,
          phase_budget_sec: { beta: 0, alpha: 180, theta: thetaBudget, gamma: 140 },
        },
        segments,
      },
      { expectedThetaSteps: steps },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unexpected theta steps against expectedThetaSteps", () => {
    const steps = [1, 2, 12];
    const segments = [
      {
        seq: 1,
        phase: "alpha",
        step: null,
        pacing_wpm: 90,
        target_duration_sec: 180,
        pause_after_ms: 0,
        text: "Alpha.",
      },
      thetaSegment(2, 1, 100),
      thetaSegment(3, 2, 100),
      thetaSegment(4, 5, 100),
      thetaSegment(5, 12, 100),
      {
        seq: 6,
        phase: "gamma",
        step: null,
        pacing_wpm: 150,
        target_duration_sec: 140,
        pause_after_ms: 0,
        text: "Gamma.",
      },
    ];
    const result = validateManifest(
      {
        meta: {
          ...baseManifest.meta,
          total_duration_sec: 720,
          phase_budget_sec: { beta: 0, alpha: 180, theta: 400, gamma: 140 },
        },
        segments,
      },
      { expectedThetaSteps: steps },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("unexpected") || e.includes("order"))).toBe(
        true,
      );
    }
  });

  it("returns formatted errors when phase budgets do not sum", () => {
    const result = validateManifest({
      ...baseManifest,
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 30,
          pause_after_ms: 0,
          text: "Short.",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("phase beta"))).toBe(true);
    }
  });

  it("rejects break tags over 3.0 seconds before normalization", () => {
    const result = validateManifest({
      ...baseManifest,
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 60,
          pause_after_ms: 0,
          text: 'Pause here. <break time="3.5s"/> Continue.',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("3.0s"))).toBe(true);
    }
  });

  it("emits word-budget warnings above 115% but does not hard-fail", () => {
    const segments = [
      {
        seq: 1,
        phase: "beta",
        step: null,
        pacing_wpm: 130,
        target_duration_sec: 60,
        pause_after_ms: 1000,
        text: "You are seated now.",
      },
      {
        seq: 2,
        phase: "alpha",
        step: null,
        pacing_wpm: 90,
        target_duration_sec: 240,
        pause_after_ms: 1000,
        text: "You breathe slowly.",
      },
      ...Array.from({ length: 12 }, (_, i) => thetaSegment(3 + i, i + 1, 65)),
      {
        seq: 15,
        phase: "gamma",
        step: null,
        pacing_wpm: 150,
        target_duration_sec: 120,
        pause_after_ms: 500,
        text: "You rise with energy.",
      },
    ];

    const wordBudget = (130 * 60) / 60;
    const maxWords = Math.ceil(1.15 * wordBudget);
    const withinText = Array.from({ length: maxWords }, (_, i) => `word${i}`).join(" ");
    const overText = Array.from({ length: maxWords + 1 }, (_, i) => `word${i}`).join(" ");

    const within = validateManifest({
      ...baseManifest,
      segments: segments.map((segment) =>
        segment.seq === 1 ? { ...segment, text: withinText } : segment,
      ),
    });
    expect(within.ok).toBe(true);
    if (within.ok) {
      expect(within.warnings).toEqual([]);
    }

    const over = validateManifest({
      ...baseManifest,
      segments: segments.map((segment) =>
        segment.seq === 1 ? { ...segment, text: overText } : segment,
      ),
    });
    expect(over.ok).toBe(true);
    if (over.ok) {
      expect(over.warnings).toHaveLength(1);
      expect(over.warnings[0]).toMatch(/^word-budget:/);
      expect(over.warnings[0]).toContain("115%");
    }
  });
});
