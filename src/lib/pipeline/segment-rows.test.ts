import { describe, expect, it } from "vitest";
import { deriveSegmentRows, segmentContentHash, PHASE1_SYNTHESIS_IDENTITY } from "./segment-rows";
import type { Manifest } from "../contracts/manifest";

const fixtureManifest: Manifest = {
  meta: {
    goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
    total_duration_sec: 300,
    phase_budget_sec: { beta: 60, alpha: 120, theta: 90, gamma: 30 },
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
      text: "Beta line one.",
    },
    {
      seq: 2,
      phase: "beta",
      step: null,
      pacing_wpm: 130,
      target_duration_sec: 0,
      pause_after_ms: 0,
      text: "ignored",
    },
    {
      seq: 3,
      phase: "alpha",
      step: null,
      pacing_wpm: 90,
      target_duration_sec: 120,
      pause_after_ms: 500,
      text: "Alpha close.",
    },
  ],
};

describe("deriveSegmentRows (D5)", () => {
  it("sets entrainment_hz from plan and glide_to_hz only on last segment of gliding phases", () => {
    const rows = deriveSegmentRows(
      {
        ...fixtureManifest,
        segments: [
          fixtureManifest.segments[0]!,
          {
            seq: 2,
            phase: "beta",
            step: null,
            pacing_wpm: 130,
            target_duration_sec: 60,
            pause_after_ms: 0,
            text: "Beta line two.",
          },
          fixtureManifest.segments[2]!,
        ],
      },
      { scriptId: "script-1", userId: "user-1" },
    );

    expect(rows[0]?.entrainment_hz).toBe(18);
    expect(rows[0]?.glide_to_hz).toBeNull();
    expect(rows[1]?.glide_to_hz).toBe(10);
    expect(rows[2]?.entrainment_hz).toBe(10);
    expect(rows[2]?.glide_to_hz).toBe(6);
  });

  it("computes content_hash via Phase 1 synthesis identity", () => {
    const text = "Beta line one.";
    const rows = deriveSegmentRows(
      { ...fixtureManifest, segments: [fixtureManifest.segments[0]!] },
      { scriptId: "s", userId: "u" },
    );
    expect(rows[0]?.content_hash).toBe(segmentContentHash(text));
    expect(PHASE1_SYNTHESIS_IDENTITY.voiceId).toBe("mock-voice");
  });
});
