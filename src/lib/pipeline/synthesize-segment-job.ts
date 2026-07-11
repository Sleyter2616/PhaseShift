import { randomUUID } from "node:crypto";
import type { ServiceClient } from "@/lib/db/service-client";
import { getProvider } from "@/lib/tts/registry";
import {
  buildStoragePath,
  resolveSynthesisIdentity,
  type ScriptVoiceSource,
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

export async function runSynthesizeSegment(
  supabase: ServiceClient,
  input: SynthesizeSegmentInput,
): Promise<{ audio_file_id: string; duration_sec: number }> {
  const { script_id, segment_id, dedupe_key, text, pacing_wpm, previous_text, next_text } =
    input;

  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select(
      "provider, stock_voice_id, voice_profile_id, tts_model_id, user_id, voice_profiles(provider_voice_id)",
    )
    .eq("id", script_id)
    .single();

  if (scriptError || !script) {
    throw new Error(`script load failed: ${scriptError?.message ?? script_id}`);
  }

  const rawProfile = script.voice_profiles as
    | { provider_voice_id: string | null }
    | { provider_voice_id: string | null }[]
    | null;
  const voiceProfile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
  const identity = resolveSynthesisIdentity({
    provider: script.provider,
    user_id: script.user_id,
    stock_voice_id: script.stock_voice_id,
    voice_profile_id: script.voice_profile_id,
    provider_voice_id: voiceProfile?.provider_voice_id ?? null,
    tts_model_id: script.tts_model_id,
  } as ScriptVoiceSource);
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

  const { error: audioInsertError } = await supabase.from("audio_files").insert({
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

  if (audioInsertError) {
    throw new Error(`audio_files insert failed: ${audioInsertError.message}`);
  }

  const { error: segmentError } = await supabase
    .from("script_segments")
    .update({
      audio_file_id: audioFileId,
      actual_duration_sec: result.durationSec,
      synthesis_status: "ready",
    })
    .eq("id", segment_id)
    .eq("script_id", script_id);

  if (segmentError) {
    throw new Error(`segment update failed: ${segmentError.message}`);
  }

  return { audio_file_id: audioFileId, duration_sec: result.durationSec };
}
