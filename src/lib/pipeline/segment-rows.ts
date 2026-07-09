import type { Manifest, ManifestSegment } from "../contracts/manifest";
import { dedupeKey } from "../tts/dedupe";

export const PHASE1_SYNTHESIS_IDENTITY = {
  provider: "selfhost" as const,
  assetScope: "user" as const,
  voiceId: "mock-voice",
  modelId: "mock-1",
  settings: {} as Record<string, unknown>,
};

export interface SegmentRowInsert {
  script_id: string;
  user_id: string;
  seq: number;
  phase: ManifestSegment["phase"];
  step: number | null;
  title: string | null;
  perspective: ManifestSegment["perspective"];
  temporal_horizon: ManifestSegment["temporal_horizon"];
  archetype: ManifestSegment["archetype"];
  text: string;
  target_duration_sec: number;
  pacing_wpm: number;
  pause_after_ms: number;
  entrainment_hz: number;
  glide_to_hz: number | null;
  content_hash: string;
  synthesis_status: "pending";
}

export function segmentContentHash(text: string): string {
  return dedupeKey({
    ...PHASE1_SYNTHESIS_IDENTITY,
    text,
  });
}

export function deriveSegmentRows(
  manifest: Manifest,
  ctx: { scriptId: string; userId: string },
): SegmentRowInsert[] {
  const planByPhase = new Map(
    manifest.meta.entrainment_plan.map((entry) => [entry.phase, entry]),
  );

  const lastSeqByPhase = new Map<string, number>();
  for (const segment of manifest.segments) {
    lastSeqByPhase.set(segment.phase, segment.seq);
  }

  return manifest.segments.map((segment) => {
    const plan = planByPhase.get(segment.phase);
    if (!plan) {
      throw new Error(`missing entrainment_plan entry for phase ${segment.phase}`);
    }

    const isLastInPhase = lastSeqByPhase.get(segment.phase) === segment.seq;
    const glideTo =
      isLastInPhase && plan.glide_to !== null && plan.glide_to !== undefined
        ? plan.glide_to
        : null;

    return {
      script_id: ctx.scriptId,
      user_id: ctx.userId,
      seq: segment.seq,
      phase: segment.phase,
      step: segment.step ?? null,
      title: segment.title ?? null,
      perspective: segment.perspective ?? null,
      temporal_horizon: segment.temporal_horizon ?? null,
      archetype: segment.archetype ?? null,
      text: segment.text,
      target_duration_sec: segment.target_duration_sec,
      pacing_wpm: segment.pacing_wpm,
      pause_after_ms: segment.pause_after_ms,
      entrainment_hz: plan.hz,
      glide_to_hz: glideTo,
      content_hash: segmentContentHash(segment.text),
      synthesis_status: "pending" as const,
    };
  });
}
