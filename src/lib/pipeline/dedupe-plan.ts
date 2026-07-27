import type { ServiceClient } from "../db/service-client";
import type { AssetScope } from "../tts/dedupe";

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
  /** Other segments in this plan that share contentHash (linked after primary synth). */
  siblingSegmentIds: string[];
}

export interface DedupePlanResult {
  hits: DedupeHit[];
  misses: DedupeMiss[];
}

export interface DedupePlanContext {
  userId: string;
  assetScope: AssetScope;
}

function groupByContentHash(segments: SegmentForDedupe[]): Map<string, SegmentForDedupe[]> {
  const groups = new Map<string, SegmentForDedupe[]>();
  for (const segment of segments) {
    const list = groups.get(segment.content_hash);
    if (list) {
      list.push(segment);
    } else {
      groups.set(segment.content_hash, [segment]);
    }
  }
  return groups;
}

async function lookupAudioByDedupeKey(
  supabase: ServiceClient,
  ctx: DedupePlanContext,
  dedupeKey: string,
): Promise<{ id: string; duration_sec: number } | null> {
  let query = supabase
    .from("audio_files")
    .select("id, duration_sec")
    .eq("dedupe_key", dedupeKey)
    .eq("asset_scope", ctx.assetScope);

  if (ctx.assetScope === "user") {
    query = query.eq("user_id", ctx.userId);
  } else {
    query = query.is("user_id", null);
  }

  const { data: existing, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`dedupe lookup failed: ${error.message}`);
  }
  if (!existing?.id || existing.duration_sec == null) return null;
  return { id: existing.id, duration_sec: Number(existing.duration_sec) };
}

/**
 * Plan synthesis vs cache reuse.
 *
 * Identical content_hash values within the same generation collapse to a
 * single miss (synthesize once). Sibling segments are linked after the
 * primary cue is ready — same as a cross-script cache hit.
 */
export async function planSegmentDedupe(
  supabase: ServiceClient,
  ctx: DedupePlanContext,
  segments: SegmentForDedupe[],
): Promise<DedupePlanResult> {
  const hits: DedupeHit[] = [];
  const misses: DedupeMiss[] = [];

  for (const [, group] of groupByContentHash(segments)) {
    const primary = group[0]!;
    const existing = await lookupAudioByDedupeKey(supabase, ctx, primary.content_hash);

    if (existing) {
      for (const segment of group) {
        hits.push({
          segmentId: segment.id,
          audioFileId: existing.id,
          actualDurationSec: existing.duration_sec,
        });
      }
      continue;
    }

    misses.push({
      segmentId: primary.id,
      contentHash: primary.content_hash,
      text: primary.text,
      pacingWpm: primary.pacing_wpm,
      siblingSegmentIds: group.slice(1).map((segment) => segment.id),
    });
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

/**
 * Link every segment on a script that shares content_hash to the same audio row.
 * Used after synthesizing a cue once so N identical breath micros reuse it.
 */
export async function linkScriptSegmentsByContentHash(
  supabase: ServiceClient,
  input: {
    scriptId: string;
    contentHash: string;
    audioFileId: string;
    durationSec: number;
  },
): Promise<number> {
  const { data, error } = await supabase
    .from("script_segments")
    .update({
      audio_file_id: input.audioFileId,
      actual_duration_sec: input.durationSec,
      synthesis_status: "ready",
    })
    .eq("script_id", input.scriptId)
    .eq("content_hash", input.contentHash)
    .select("id");

  if (error) {
    throw new Error(`failed to link segments by content_hash: ${error.message}`);
  }
  return data?.length ?? 0;
}

/**
 * Safety net: any still-pending segments whose content_hash already has an
 * audio_files row get linked without re-synthesis.
 */
export async function linkPendingSegmentsFromAudioCache(
  supabase: ServiceClient,
  ctx: DedupePlanContext,
  scriptId: string,
): Promise<number> {
  const { data: pending, error } = await supabase
    .from("script_segments")
    .select("id, content_hash")
    .eq("script_id", scriptId)
    .neq("synthesis_status", "ready");

  if (error) {
    throw new Error(`pending segment load failed: ${error.message}`);
  }
  if (!pending?.length) return 0;

  let linked = 0;
  const seen = new Set<string>();
  for (const segment of pending) {
    if (seen.has(segment.content_hash)) continue;
    seen.add(segment.content_hash);

    const existing = await lookupAudioByDedupeKey(supabase, ctx, segment.content_hash);
    if (!existing) continue;

    linked += await linkScriptSegmentsByContentHash(supabase, {
      scriptId,
      contentHash: segment.content_hash,
      audioFileId: existing.id,
      durationSec: existing.duration_sec,
    });
  }
  return linked;
}

export async function countAudioFilesForDedupeKeys(
  supabase: ServiceClient,
  ctx: DedupePlanContext,
  dedupeKeys: string[],
): Promise<number> {
  if (dedupeKeys.length === 0) return 0;

  let query = supabase
    .from("audio_files")
    .select("id", { count: "exact", head: true })
    .eq("asset_scope", ctx.assetScope)
    .in("dedupe_key", dedupeKeys);

  if (ctx.assetScope === "user") {
    query = query.eq("user_id", ctx.userId);
  } else {
    query = query.is("user_id", null);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`audio_files count failed: ${error.message}`);
  }
  return count ?? 0;
}

/** Pure helper for tests: collapse segments into unique synthesis misses. */
export function uniqueMissesFromSegments(segments: SegmentForDedupe[]): DedupeMiss[] {
  const groups = groupByContentHash(segments);
  const misses: DedupeMiss[] = [];
  for (const [, group] of groups) {
    const primary = group[0]!;
    misses.push({
      segmentId: primary.id,
      contentHash: primary.content_hash,
      text: primary.text,
      pacingWpm: primary.pacing_wpm,
      siblingSegmentIds: group.slice(1).map((segment) => segment.id),
    });
  }
  return misses;
}
