import { randomUUID } from "node:crypto";
import type { ServiceClient } from "@/lib/db/service-client";
import { getProvider } from "@/lib/tts/registry";
import {
  buildStoragePath,
  resolveSynthesisIdentity,
  type ScriptVoiceSource,
} from "./synthesis-identity";

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
    .select("provider, stock_voice_id, voice_profile_id, tts_model_id, user_id")
    .eq("id", script_id)
    .single();

  if (scriptError || !script) {
    throw new Error(`script load failed: ${scriptError?.message ?? script_id}`);
  }

  const identity = resolveSynthesisIdentity(script as ScriptVoiceSource);
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

  const { error: uploadError } = await supabase.storage
    .from("audio")
    .upload(storagePath, result.audio, {
      contentType: "audio/mpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`storage upload failed: ${uploadError.message}`);
  }

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
