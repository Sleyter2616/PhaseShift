import { randomUUID } from "node:crypto";
import type { ServiceClient } from "@/lib/db/service-client";
import { MockTTSProvider } from "@/lib/tts/mock";

export interface SynthesizeSegmentInput {
  script_id: string;
  segment_id: string;
  user_id: string;
  dedupe_key: string;
  text: string;
  pacing_wpm: number;
}

export async function runSynthesizeSegment(
  supabase: ServiceClient,
  input: SynthesizeSegmentInput,
): Promise<{ audio_file_id: string; duration_sec: number }> {
  const { script_id, segment_id, user_id, dedupe_key, text, pacing_wpm } = input;
  const audioFileId = randomUUID();
  const storagePath = `${user_id}/${audioFileId}.mp3`;

  const provider = new MockTTSProvider(pacing_wpm);
  const result = await provider.synthesize({
    text,
    voiceId: "mock-voice",
    modelId: "mock-1",
    settings: {},
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
    user_id,
    asset_scope: "user",
    provider: "selfhost",
    dedupe_key,
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
