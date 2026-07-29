import { describe, expect, it, vi, afterEach } from "vitest";
import {
  COMPILE_LENGTH_MIN_RATIO,
  estimateManifestWallClockSec,
  formatLengthExpandRetryMessage,
  isCompileEstimateUnderfilled,
  logCompileLengthTelemetry,
  summarizeThetaWordShortfalls,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("estimates speech from pacing_wpm", () => {
    const est = estimateManifestWallClockSec(manifestWithWords(105));
    expect(est).toBeCloseTo(60, 0);
  });

  it("flags underfill below 97% of target", () => {
    expect(COMPILE_LENGTH_MIN_RATIO).toBe(0.97);
    expect(isCompileEstimateUnderfilled(800, 900)).toBe(true);
    expect(isCompileEstimateUnderfilled(870, 900)).toBe(true); // 96.7%
    expect(isCompileEstimateUnderfilled(873, 900)).toBe(false); // 97%
  });

  it("lists per-step word shortfalls for expand messaging", () => {
    const msg = formatLengthExpandRetryMessage({
      estimatedSec: 1593,
      targetSec: 1800,
      thetaSteps: [
        { step: 1, target_words: 200 },
        { step: 12, target_words: 180 },
      ],
      segments: [
        { phase: "theta", step: 1, text: Array.from({ length: 150 }, () => "w").join(" ") },
        { phase: "theta", step: 12, text: Array.from({ length: 100 }, () => "w").join(" ") },
      ],
    });
    expect(msg).toContain("Your draft totals ~26.6 minutes; target is 30");
    expect(msg).toContain("Theta steps [1, 12]");
    expect(msg).toContain("under by 50");
    expect(msg).toContain("under by 80");
    expect(msg).toContain("Do not add steps");
  });

  it("logs estimated-vs-target telemetry", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const shortfalls = summarizeThetaWordShortfalls(
      [{ step: 1, target_words: 100 }],
      [{ phase: "theta", step: 1, text: "only a few words here" }],
    );
    logCompileLengthTelemetry({
      estimatedSec: 1593,
      targetSec: 1800,
      attempt: 1,
      lengthExpandRetries: 0,
      shortfalls,
      accepting: false,
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("length-telemetry:"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("estimate=1593.0s"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("target=1800s"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("theta_words:"));
  });
});
