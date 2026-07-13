import { describe, expect, it } from "vitest";
import { applySpeakableOutputNormalization } from "./speakable-output";

describe("applySpeakableOutputNormalization", () => {
  it("normalizes model-written symbols in segment text before persistence", () => {
    const { manifest, changes } = applySpeakableOutputNormalization({
      meta: {
        goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
        total_duration_sec: 120,
        phase_budget_sec: { beta: 60, alpha: 30, theta: 20, gamma: 10 },
        entrainment_plan: [{ phase: "beta", hz: 18 }],
      },
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: 1,
          pacing_wpm: 130,
          target_duration_sec: 60,
          pause_after_ms: 0,
          text: "Close the $1M offer by 2027-05-07 at 9 AM.",
        },
      ],
    });

    expect(manifest.segments[0]?.text).toBe(
      "Close the one million dollars offer by May seventh, twenty twenty-seven at nine A M.",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.seq).toBe(1);
  });

  it("leaves already-speakable text unchanged", () => {
    const text = "Breathe slowly and settle into the chair.";
    const { manifest, changes } = applySpeakableOutputNormalization({
      meta: {
        goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
        total_duration_sec: 60,
        phase_budget_sec: { beta: 60, alpha: 0, theta: 0, gamma: 0 },
        entrainment_plan: [{ phase: "beta", hz: 18 }],
      },
      segments: [
        {
          seq: 1,
          phase: "beta",
          step: null,
          pacing_wpm: 130,
          target_duration_sec: 60,
          pause_after_ms: 0,
          text,
        },
      ],
    });

    expect(manifest.segments[0]?.text).toBe(text);
    expect(changes).toEqual([]);
  });
});
