import type { ServiceClient } from "../db/service-client";

export interface SegmentForDedupe {
  id: string;
  content_hash: string;
  text: string;
  pacing_wpm: number;
}

export interface DedupeHit {
  segmentId: string;
  audioFileId: string;
  actualDurationSec: number;
}

export interface DedupeMiss {
  segmentId: string;
  contentHash: string;
  text: string;
  pacingWpm: number;
}

export interface DedupePlanResult {
  hits: DedupeHit[];
  misses: DedupeMiss[];
}

export async function planSegmentDedupe(
  supabase: ServiceClient,
  userId: string,
  segments: SegmentForDedupe[],
): Promise<DedupePlanResult> {
  const hits: DedupeHit[] = [];
  const misses: DedupeMiss[] = [];

  for (const segment of segments) {
    const { data: existing, error } = await supabase
      .from("audio_files")
      .select("id, duration_sec")
      .eq("user_id", userId)
      .eq("dedupe_key", segment.content_hash)
      .eq("asset_scope", "user")
      .maybeSingle();

    if (error) {
      throw new Error(`dedupe lookup failed: ${error.message}`);
    }

    if (existing?.id && existing.duration_sec != null) {
      hits.push({
        segmentId: segment.id,
        audioFileId: existing.id,
        actualDurationSec: Number(existing.duration_sec),
      });
    } else {
      misses.push({
        segmentId: segment.id,
        contentHash: segment.content_hash,
        text: segment.text,
        pacingWpm: segment.pacing_wpm,
      });
    }
  }

  return { hits, misses };
}

export async function applyDedupeHits(
  supabase: ServiceClient,
  hits: DedupeHit[],
): Promise<void> {
  for (const hit of hits) {
    const { error } = await supabase
      .from("script_segments")
      .update({
        audio_file_id: hit.audioFileId,
        actual_duration_sec: hit.actualDurationSec,
        synthesis_status: "ready",
      })
      .eq("id", hit.segmentId);

    if (error) {
      throw new Error(`failed to link dedupe hit: ${error.message}`);
    }
  }
}
