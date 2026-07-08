import { describe, expect, it } from "vitest";
import { chainBreakTags, normalizeManifest } from "./normalize";

describe("chainBreakTags", () => {
  it("chains 8.0s into 3.0+3.0+2.0", () => {
    expect(chainBreakTags(8.0)).toBe(
      '<break time="3.0s"/><break time="3.0s"/><break time="2.0s"/>',
    );
  });

  it("chains 4.0s into 3.0+1.0", () => {
    expect(chainBreakTags(4.0)).toBe('<break time="3.0s"/><break time="1.0s"/>');
  });
});

describe("normalizeManifest", () => {
  const baseMeta = {
    goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
    total_duration_sec: 60,
    phase_budget_sec: { beta: 60, alpha: 240, theta: 780, gamma: 120 },
    entrainment_plan: [{ phase: "beta", hz: 18 }],
  };

  it("chains canonical breaks above 3.0s in segment text", () => {
    const { manifest, actions } = normalizeManifest({
      meta: baseMeta,
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 60,
          pause_after_ms: 0,
          text: 'Hold. <break time="8.0s"/> Continue.',
        },
      ],
    });

    const segment = (manifest as { segments: Array<{ text: string }> }).segments[0];
    expect(segment?.text).toBe(
      'Hold. <break time="3.0s"/><break time="3.0s"/><break time="2.0s"/> Continue.',
    );
    expect(actions.some((a) => a.includes("chained"))).toBe(true);
  });

  it("rescales phase targets within 5% to sum exactly to budget", () => {
    const { manifest, actions } = normalizeManifest({
      meta: baseMeta,
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 28,
          pause_after_ms: 0,
          text: "One.",
        },
        {
          seq: 2,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 30,
          pause_after_ms: 0,
          text: "Two.",
        },
      ],
    });

    const segments = (manifest as { segments: Array<{ target_duration_sec: number }> }).segments;
    const sum = segments.reduce((acc, s) => acc + s.target_duration_sec, 0);
    expect(sum).toBe(60);
    expect(actions.some((a) => a.includes("rescaled"))).toBe(true);
  });

  it("leaves phase targets untouched when deviation exceeds 5%", () => {
    const { manifest, actions } = normalizeManifest({
      meta: baseMeta,
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 20,
          pause_after_ms: 0,
          text: "One.",
        },
        {
          seq: 2,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 20,
          pause_after_ms: 0,
          text: "Two.",
        },
      ],
    });

    const segments = (manifest as { segments: Array<{ target_duration_sec: number }> }).segments;
    expect(segments.map((s) => s.target_duration_sec)).toEqual([20, 20]);
    expect(actions.some((a) => a.includes("rescaled"))).toBe(false);
  });
});
