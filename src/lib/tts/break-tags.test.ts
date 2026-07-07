import { describe, expect, it } from "vitest";
import { validateManifest } from "../contracts/manifest";
import { stripBreaks } from "./breaks";

function buildValidManifest(betaText: string) {
  const thetaSegment = (seq: number, step: number) => ({
    seq,
    phase: "theta",
    step,
    perspective: "first",
    temporal_horizon: "protospective",
    archetype: null,
    pacing_wpm: 105,
    target_duration_sec: 65,
    pause_after_ms: 500,
    text: "I hold the scene with steady focus.",
  });

  return {
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
    segments: [
      {
        seq: 1,
        phase: "beta",
        step: null,
        pacing_wpm: 130,
        target_duration_sec: 60,
        pause_after_ms: 1000,
        text: betaText,
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
      ...Array.from({ length: 12 }, (_, i) => thetaSegment(3 + i, i + 1)),
      {
        seq: 15,
        phase: "gamma",
        step: null,
        pacing_wpm: 150,
        target_duration_sec: 120,
        pause_after_ms: 500,
        text: "You rise with energy.",
      },
    ],
  };
}

function assertAdversarialVector(tagSnippet: string) {
  const text = `Pause here. ${tagSnippet} Continue.`;
  const { cleanText } = stripBreaks(text);
  expect(cleanText.toLowerCase()).not.toContain("<break");

  const result = validateManifest(buildValidManifest(text));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes("malformed break tag"))).toBe(true);
  }
}

describe("adversarial break-tag vectors", () => {
  it('rejects time="1.575s" (too many decimals) and strips it from cleanText', () => {
    assertAdversarialVector('<break time="1.575s"/>');
  });

  it("rejects single-quoted time='2.0s' and strips it from cleanText", () => {
    assertAdversarialVector("<break time='2.0s'/>");
  });

  it('rejects time="500ms" unit variant and strips it from cleanText', () => {
    assertAdversarialVector('<break time="500ms"/>');
  });

  it("rejects extra strength attribute and strips it from cleanText", () => {
    assertAdversarialVector('<break strength="medium" time="2.0s"/>');
  });

  it("rejects single-quoted 5.0s cap-bypass attempt via malformed tag error", () => {
    const text = "Hold. <break time='5.0s'/> Rise.";
    const { cleanText } = stripBreaks(text);
    expect(cleanText.toLowerCase()).not.toContain("<break");

    const result = validateManifest(buildValidManifest(text));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("malformed break tag"))).toBe(true);
      expect(result.errors.some((e) => e.includes("exceeds 3.0s maximum"))).toBe(false);
    }
  });
});
