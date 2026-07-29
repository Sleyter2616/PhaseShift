import { describe, expect, it } from "vitest";
import {
  estimateManifestWallClockSec,
  isCompileEstimateUnderfilled,
} from "./estimate-duration";
import type { Manifest } from "../contracts/manifest";

function manifestWithWords(words: number, pacing = 105, targetSec = 600): Manifest {
  const text = Array.from({ length: words }, () => "word").join(" ");
  return {
    meta: {
      goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
      total_duration_sec: targetSec,
      phase_budget_sec: { beta: 0, alpha: 100, theta: 400, gamma: 100 },
      entrainment_plan: [
        { phase: "alpha", hz: 10, glide_to: null },
        { phase: "theta", hz: 6, glide_to: null },
        { phase: "gamma", hz: 40, glide_to: null },
      ],
    },
    segments: [
      {
        seq: 1,
        phase: "theta",
        step: 1,
        title: "Step",
        perspective: "first",
        temporal_horizon: "protospective",
        archetype: null,
        pacing_wpm: pacing,
        target_duration_sec: 400,
        pause_after_ms: 0,
        text,
      },
    ],
  };
}

describe("estimate-duration", () => {
  it("estimates speech from pacing_wpm", () => {
    const est = estimateManifestWallClockSec(manifestWithWords(105));
    expect(est).toBeCloseTo(60, 0);
  });

  it("flags underfill below 92% of target", () => {
    expect(isCompileEstimateUnderfilled(800, 900)).toBe(true);
    expect(isCompileEstimateUnderfilled(830, 900)).toBe(false);
  });
});
