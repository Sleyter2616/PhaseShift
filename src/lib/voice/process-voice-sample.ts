import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/db/service-client";
import { defaultTtsProvider } from "@/lib/pipeline/synthesis-identity";
import { cloneVoiceWithElevenLabs, mockClonedVoiceId } from "@/lib/tts/clone-voice";
import { voiceSampleStoragePath } from "./sample-limits";

export function voicesApiKey(): string | undefined {
  return process.env.ELEVENLABS_VOICES_API_KEY ?? process.env.ELEVENLABS_API_KEY;
}

export async function storeVoiceSample(
  userId: string,
  audio: Blob,
): Promise<{ error?: string }> {
  const service = getServiceClient();
  const path = voiceSampleStoragePath(userId);
  const bytes = new Uint8Array(await audio.arrayBuffer());

  const { error } = await service.storage.from("voice-samples").upload(path, bytes, {
    contentType: audio.type || "audio/webm",
    upsert: true,
  });

  if (error) {
    return { error: `storage upload failed: ${error.message}` };
  }
  return {};
}

export async function processVoiceSample(
  supabase: SupabaseClient,
  userId: string,
  audio: Blob,
): Promise<{ error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from("voice_profiles")
    .select("id, consent_confirmed_at")
    .maybeSingle();

  if (profileError) {
    return { error: profileError.message };
  }
  if (!profile?.id || !profile.consent_confirmed_at) {
    return { error: "consent required before recording" };
  }

  const { error: pendingError } = await supabase
    .from("voice_profiles")
    .update({ status: "pending" })
    .eq("id", profile.id);

  if (pendingError) {
    return { error: pendingError.message };
  }

  const storageResult = await storeVoiceSample(userId, audio);
  if (storageResult.error) {
    await supabase.from("voice_profiles").update({ status: "failed" }).eq("id", profile.id);
    return storageResult;
  }

  let providerVoiceId: string;
  const provider = defaultTtsProvider();
  const apiKey = voicesApiKey();

  try {
    if (provider === "selfhost" || !apiKey) {
      providerVoiceId = mockClonedVoiceId(userId);
    } else {
      providerVoiceId = await cloneVoiceWithElevenLabs(
        apiKey,
        `phaseshift-${userId.slice(0, 8)}`,
        audio,
      );
    }
  } catch (cloneError) {
    const message = cloneError instanceof Error ? cloneError.message : "voice clone failed";
    await supabase.from("voice_profiles").update({ status: "failed" }).eq("id", profile.id);
    return { error: message };
  }

  const { error: readyError } = await supabase
    .from("voice_profiles")
    .update({
      provider_voice_id: providerVoiceId,
      status: "ready",
    })
    .eq("id", profile.id);

  if (readyError) {
    return { error: readyError.message };
  }

  return {};
}
