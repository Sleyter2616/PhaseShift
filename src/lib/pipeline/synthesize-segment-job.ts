import { randomUUID } from "node:crypto";
import type { ServiceClient } from "@/lib/db/service-client";
import { getProvider } from "@/lib/tts/registry";
import { linkScriptSegmentsByContentHash } from "./dedupe-plan";
import {
  buildStoragePath,
  loadScriptSynthesisIdentity,
} from "./synthesis-identity";

export const UPLOAD_RETRY_BACKOFF_MS = [500, 1500] as const;

export async function uploadAudioWithRetry(
  uploadFn: () => Promise<{ error: { message: string } | null }>,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const maxAttempts = UPLOAD_RETRY_BACKOFF_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error } = await uploadFn();
    if (!error) return;
    if (attempt === maxAttempts - 1) {
      throw new Error(`storage upload failed: ${error.message}`);
    }
    await sleepFn(UPLOAD_RETRY_BACKOFF_MS[attempt]!);
  }
}

export interface SynthesizeSegmentInput {
  script_id: string;
  segment_id: string;
  user_id: string;
  dedupe_key: string;
  text: string;
  pacing_wpm: number;
  previous_text?: string;
  next_text?: string;
}

export function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  if (error.code === "23505") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("audio_files_shared_dedupe_idx") ||
    message.includes("audio_files_user_dedupe_idx")
  );
}

/**
 * Insert audio_files row; on unique(dedupe_key) conflict, fetch and return the
 * existing row instead of throwing (parallel synthesis of the same cue).
 */
export async function insertAudioFileOrFetchExisting(
  supabase: ServiceClient,
  row: {
    id: string;
    user_id: string | null;
    asset_scope: "user" | "shared";
    provider: string;
    dedupe_key: string;
    storage_path: string;
    duration_sec: number;
    bytes: number;
    format: string;
    provider_request_id: string | null;
  },
): Promise<{ audioFileId: string; durationSec: number; reused: boolean }> {
  const { error: audioInsertError } = await supabase.from("audio_files").insert(row);

  if (!audioInsertError) {
    return { audioFileId: row.id, durationSec: row.duration_sec, reused: false };
  }

  if (!isUniqueViolation(audioInsertError)) {
    throw new Error(`audio_files insert failed: ${audioInsertError.message}`);
  }

  let query = supabase
    .from("audio_files")
    .select("id, duration_sec")
    .eq("dedupe_key", row.dedupe_key)
    .eq("asset_scope", row.asset_scope);

  if (row.asset_scope === "user") {
    query = query.eq("user_id", row.user_id);
  } else {
    query = query.is("user_id", null);
  }

  const { data: existing, error: fetchError } = await query.maybeSingle();
  if (fetchError || !existing?.id || existing.duration_sec == null) {
    throw new Error(
      `audio_files dedupe conflict but existing row missing: ${fetchError?.message ?? row.dedupe_key}`,
    );
  }

  return {
    audioFileId: existing.id,
    durationSec: Number(existing.duration_sec),
    reused: true,
  };
}

export async function runSynthesizeSegment(
  supabase: ServiceClient,
  input: SynthesizeSegmentInput,
): Promise<{ audio_file_id: string; duration_sec: number }> {
  const { script_id, segment_id, dedupe_key, text, pacing_wpm, previous_text, next_text } =
    input;

  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("provider, stock_voice_id, voice_profile_id, tts_model_id, user_id")
    .eq("id", script_id)
    .single();

  if (scriptError || !script) {
    throw new Error(`script load failed: ${scriptError?.message ?? script_id}`);
  }

  const identity = await loadScriptSynthesisIdentity(supabase, script);

  // Fast path: another job already inserted this cue — link and return.
  {
    let existingQuery = supabase
      .from("audio_files")
      .select("id, duration_sec")
      .eq("dedupe_key", dedupe_key)
      .eq("asset_scope", identity.assetScope);
    if (identity.assetScope === "user") {
      existingQuery = existingQuery.eq("user_id", script.user_id);
    } else {
      existingQuery = existingQuery.is("user_id", null);
    }
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing?.id && existing.duration_sec != null) {
      await linkScriptSegmentsByContentHash(supabase, {
        scriptId: script_id,
        contentHash: dedupe_key,
        audioFileId: existing.id,
        durationSec: Number(existing.duration_sec),
      });
      return { audio_file_id: existing.id, duration_sec: Number(existing.duration_sec) };
    }
  }

  const audioFileId = randomUUID();
  const storagePath = buildStoragePath(identity, audioFileId);

  await supabase
    .from("script_segments")
    .update({ synthesis_status: "processing" })
    .eq("id", segment_id)
    .eq("script_id", script_id);

  const provider = getProvider(identity.provider, { pacingWpm: pacing_wpm });

  const result = await provider.synthesize({
    text,
    voiceId: identity.voiceId,
    modelId: identity.modelId,
    settings: identity.settings,
    previousText: previous_text,
    nextText: next_text,
  });

  await uploadAudioWithRetry(() =>
    supabase.storage.from("audio").upload(storagePath, result.audio, {
      contentType: "audio/mpeg",
      upsert: false,
    }),
  );

  const inserted = await insertAudioFileOrFetchExisting(supabase, {
    id: audioFileId,
    user_id: identity.assetScope === "user" ? script.user_id : null,
    asset_scope: identity.assetScope,
    provider: identity.provider,
    dedupe_key: dedupe_key,
    storage_path: storagePath,
    duration_sec: result.durationSec,
    bytes: result.audio.byteLength,
    format: "mp3",
    provider_request_id: result.requestId ?? null,
  });

  // Link primary + any siblings on this script that share the cue hash.
  await linkScriptSegmentsByContentHash(supabase, {
    scriptId: script_id,
    contentHash: dedupe_key,
    audioFileId: inserted.audioFileId,
    durationSec: inserted.durationSec,
  });

  return { audio_file_id: inserted.audioFileId, duration_sec: inserted.durationSec };
}
