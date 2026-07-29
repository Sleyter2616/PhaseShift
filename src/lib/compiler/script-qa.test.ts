import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fixPersonAgreementInText,
  logScriptQaFindings,
  runScriptQa,
  sentenceNeedsPersonAgreementFix,
} from "./script-qa";
import type { Manifest } from "../contracts/manifest";

function baseManifest(segments: Manifest["segments"]): Manifest {
  return {
    meta: {
      goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
      total_duration_sec: 900,
      phase_budget_sec: { beta: 60, alpha: 180, theta: 520, gamma: 140 },
      entrainment_plan: [
        { phase: "beta", hz: 18, glide_to: null },
        { phase: "alpha", hz: 10, glide_to: null },
        { phase: "theta", hz: 6, glide_to: null },
        { phase: "gamma", hz: 40, glide_to: null },
      ],
    },
    segments,
  };
}

describe("script-qa person agreement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects you+my mismatch sentences", () => {
    expect(sentenceNeedsPersonAgreementFix("You are inside my Hamilton Heights apartment.")).toBe(
      true,
    );
    expect(sentenceNeedsPersonAgreementFix("The role is mine.")).toBe(false);
  });

  it("corrects 'you are inside my apartment' to your", () => {
    const { text, fixes } = fixPersonAgreementInText(
      "You are inside my Hamilton Heights apartment.",
    );
    expect(text).toBe("You are inside your Hamilton Heights apartment.");
    expect(fixes.length).toBe(1);
  });

  it("does not alter a first-person goal declaration", () => {
    const { text, fixes } = fixPersonAgreementInText(
      "The senior engineer role is mine. I claim it now.",
    );
    expect(text).toBe("The senior engineer role is mine. I claim it now.");
    expect(fixes).toEqual([]);
  });

  it("fixes only the mismatched sentence in a mixed segment", () => {
    const { text } = fixPersonAgreementInText(
      "You are inside my Hamilton Heights apartment. The role is mine.",
    );
    expect(text).toContain("your Hamilton Heights apartment");
    expect(text).toContain("The role is mine.");
  });

  it("runScriptQa rewrites the segment and logs telemetry", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manifest = baseManifest([
      {
        seq: 1,
        phase: "theta",
        step: 1,
        title: "Visualize",
        perspective: "first",
        temporal_horizon: "protospective",
        archetype: null,
        pacing_wpm: 105,
        target_duration_sec: 60,
        pause_after_ms: 500,
        text: "You are inside my Hamilton Heights apartment. The role is mine.",
      },
    ]);

    const result = runScriptQa(manifest);
    expect(result.manifest.segments[0]!.text).toContain("your Hamilton Heights apartment");
    expect(result.manifest.segments[0]!.text).toContain("The role is mine.");
    expect(result.findings.some((f) => f.kind === "person_agreement" && f.fixed)).toBe(true);

    logScriptQaFindings(result.findings);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("script-qa:"));
  });

  it("flags template artifacts without auto-fixing them", () => {
    const manifest = baseManifest([
      {
        seq: 1,
        phase: "alpha",
        step: null,
        pacing_wpm: 90,
        target_duration_sec: 30,
        pause_after_ms: 500,
        text: "You settle into {place} and soften.",
      },
    ]);
    const result = runScriptQa(manifest);
    expect(result.manifest.segments[0]!.text).toContain("{place}");
    expect(result.findings.some((f) => f.kind === "template_artifact" && !f.fixed)).toBe(true);
  });
});
