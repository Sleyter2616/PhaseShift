import { describe, expect, it } from "vitest";
import type { PlaybackManifest } from "@/lib/playback/manifest";
import {
  computeSegmentSchedule,
  deriveGlideBoundaries,
  totalPlaybackSec,
  voicesDueInWindow,
  glidesDueInWindow,
  upcomingSegmentSeqs,
  buildSeekPlan,
  clampSeekTarget,
  resolveSeekPosition,
  voiceSeqsCompletedBySeek,
} from "./scheduler";

export const PLAYBACK_FIXTURE: PlaybackManifest = {
  meta: {
    script_id: "fixture-script",
    status: "ready",
    goal_version_id: "goal-1",
    total_duration_sec: 30,
    entrainment_mode: "isochronic",
    entrainment_plan: [
      { phase: "beta", hz: 18, glide_to: 10, glide_sec: 5 },
      { phase: "alpha", hz: 10, glide_to: 6, glide_sec: 4 },
      { phase: "theta", hz: 6, glide_to: null },
      { phase: "gamma", hz: 40, glide_sec: 2 },
    ],
    error_message: null,
    provider: "elevenlabs",
  },
  segments: [
    {
      seq: 1,
      phase: "beta",
      entrainment_hz: 18,
      glide_to_hz: 10,
      actual_duration_sec: 10,
      scheduled_pause_after_ms: 0,
      signedUrl: "https://example.com/1.mp3",
    },
    {
      seq: 2,
      phase: "alpha",
      entrainment_hz: 10,
      glide_to_hz: 6,
      actual_duration_sec: 8,
      scheduled_pause_after_ms: 2000,
      signedUrl: "https://example.com/2.mp3",
    },
    {
      seq: 3,
      phase: "theta",
      entrainment_hz: 6,
      glide_to_hz: null,
      actual_duration_sec: 10,
      scheduled_pause_after_ms: 0,
      signedUrl: "https://example.com/3.mp3",
    },
  ],
};

describe("computeSegmentSchedule", () => {
  it("offsets segments by voiced duration plus scheduled pause", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    expect(schedule).toEqual([
      { seq: 1, phase: "beta", startSec: 0, voiceDurationSec: 10, pauseAfterSec: 0, endSec: 10 },
      { seq: 2, phase: "alpha", startSec: 10, voiceDurationSec: 8, pauseAfterSec: 2, endSec: 20 },
      { seq: 3, phase: "theta", startSec: 20, voiceDurationSec: 10, pauseAfterSec: 0, endSec: 30 },
    ]);
    expect(totalPlaybackSec(schedule)).toBe(30);
  });
});

describe("deriveGlideBoundaries", () => {
  it("places glides at phase boundaries with plan glide_sec", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    const glides = deriveGlideBoundaries(schedule, PLAYBACK_FIXTURE.meta.entrainment_plan);

    expect(glides).toEqual([
      { atSec: 10, fromHz: 18, toHz: 10, durationSec: 5, fromPhase: "beta" },
      { atSec: 20, fromHz: 10, toHz: 6, durationSec: 4, fromPhase: "alpha" },
    ]);
  });
});

describe("lookahead windows", () => {
  it("selects voice events inside the 3s lookahead window", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    const sessionStart = 100;
    const due = voicesDueInWindow(schedule, sessionStart, 100, new Set());
    expect(due).toEqual([{ seq: 1, atCtxTime: 100 }]);

    const later = voicesDueInWindow(schedule, sessionStart, 108, new Set([1]));
    expect(later).toEqual([{ seq: 2, atCtxTime: 110 }]);
  });

  it("selects glide boundaries inside the lookahead window", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    const glides = deriveGlideBoundaries(schedule, PLAYBACK_FIXTURE.meta.entrainment_plan);
    const due = glidesDueInWindow(glides, 50, 59, new Set());
    expect(due).toHaveLength(1);
    expect(due[0]?.fromPhase).toBe("beta");
  });

  it("returns upcoming segment seqs for JIT decode lookahead", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    expect(upcomingSegmentSeqs(schedule, 0, 5, 2)).toEqual([2, 3]);
    expect(upcomingSegmentSeqs(schedule, 0, 12, 2)).toEqual([3]);
  });
});

describe("seekTo offset math", () => {
  it("clamps seek targets to session bounds", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    expect(clampSeekTarget(-5, totalPlaybackSec(schedule))).toBe(0);
    expect(clampSeekTarget(999, totalPlaybackSec(schedule))).toBe(30);
  });

  it("resolves intra-segment offset mid-voice and mid-pause", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    const total = totalPlaybackSec(schedule);

    expect(resolveSeekPosition(schedule, 5, total)).toEqual({
      targetSec: 5,
      segmentSeq: 1,
      intraSegmentOffsetSec: 5,
      inVoice: true,
      segmentStartSec: 0,
    });

    expect(resolveSeekPosition(schedule, 19, total)).toEqual({
      targetSec: 19,
      segmentSeq: 2,
      intraSegmentOffsetSec: 0,
      inVoice: false,
      segmentStartSec: 10,
    });
  });

  it("marks completed voices and glides when seeking forward", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    const glides = deriveGlideBoundaries(schedule, PLAYBACK_FIXTURE.meta.entrainment_plan);
    const plan = buildSeekPlan(
      schedule,
      glides,
      PLAYBACK_FIXTURE.segments.map((segment) => ({
        seq: segment.seq,
        entrainment_hz: segment.entrainment_hz,
      })),
      21,
      totalPlaybackSec(schedule),
    );

    expect(plan.completedVoiceSeqs).toEqual([1, 2]);
    expect(plan.triggeredGlideKeys).toEqual(["beta:10", "alpha:20"]);
    expect(plan.entrainmentHz).toBe(6);
    expect(plan.position).toEqual({
      targetSec: 21,
      segmentSeq: 3,
      intraSegmentOffsetSec: 1,
      inVoice: true,
      segmentStartSec: 20,
    });
  });

  it("resets completed voices when seeking backward", () => {
    const schedule = computeSegmentSchedule(PLAYBACK_FIXTURE.segments);
    expect(voiceSeqsCompletedBySeek(schedule, 3)).toEqual([]);
    expect(voiceSeqsCompletedBySeek(schedule, 11)).toEqual([1]);
  });
});
