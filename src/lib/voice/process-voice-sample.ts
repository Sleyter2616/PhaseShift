import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/db/service-client";
import { cloneVoiceWithElevenLabs } from "@/lib/tts/clone-voice";
import { voiceSampleStoragePath } from "./sample-limits";

export const VOICE_CLONING_NOT_CONFIGURED = "voice cloning not configured";

export function voicesApiKey(): string | undefined {
  return process.env.ELEVENLABS_VOICES_API_KEY;
}

export function isMockProviderVoiceId(id: string | null | undefined): boolean {
  return id?.startsWith("mock-clone-") ?? false;
}

export function isRealReadyProfile(profile: {
  status: string;
  provider_voice_id: string | null;
}): boolean {
  return (
    profile.status === "ready" &&
    profile.provider_voice_id != null &&
    !isMockProviderVoiceId(profile.provider_voice_id)
  );
}

export async function downloadStoredVoiceSample(userId: string): Promise<Blob | null> {
  const service = getServiceClient();
  const path = voiceSampleStoragePath(userId);
  const { data, error } = await service.storage.from("voice-samples").download(path);
  if (error || !data || data.size === 0) return null;
  return data;
}

export async function storedVoiceSampleExists(userId: string): Promise<boolean> {
  const sample = await downloadStoredVoiceSample(userId);
  return sample != null;
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

interface CloneRunResult {
  providerVoiceId?: string;
  error?: string;
  notConfigured?: boolean;
}

async function runElevenLabsClone(
  supabase: SupabaseClient,
  profileId: string,
  userId: string,
  audio: Blob,
): Promise<CloneRunResult> {
  const apiKey = voicesApiKey();
  if (!apiKey) {
    await supabase
      .from("voice_profiles")
      .update({ status: "failed", provider_voice_id: null })
      .eq("id", profileId);
    return { error: VOICE_CLONING_NOT_CONFIGURED, notConfigured: true };
  }

  try {
    const providerVoiceId = await cloneVoiceWithElevenLabs(
      apiKey,
      `phaseshift-${userId.slice(0, 8)}`,
      audio,
    );
    return { providerVoiceId };
  } catch (cloneError) {
    const message = cloneError instanceof Error ? cloneError.message : "voice clone failed";
    await supabase
      .from("voice_profiles")
      .update({ status: "failed", provider_voice_id: null })
      .eq("id", profileId);
    return { error: message };
  }
}

async function markVoiceProfileReady(
  supabase: SupabaseClient,
  profileId: string,
  providerVoiceId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("voice_profiles")
    .update({
      provider_voice_id: providerVoiceId,
      status: "ready",
    })
    .eq("id", profileId);

  if (error) {
    return { error: error.message };
  }
  return {};
}

export interface VoiceProcessResult {
  provider_voice_id?: string;
  error?: string;
  notConfigured?: boolean;
}

export async function processVoiceSample(
  supabase: SupabaseClient,
  userId: string,
  audio: Blob,
): Promise<VoiceProcessResult> {
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

  const cloneResult = await runElevenLabsClone(supabase, profile.id, userId, audio);
  if (cloneResult.notConfigured) {
    return { error: cloneResult.error, notConfigured: true };
  }
  if (cloneResult.error || !cloneResult.providerVoiceId) {
    return { error: cloneResult.error ?? "voice clone failed" };
  }

  const readyResult = await markVoiceProfileReady(
    supabase,
    profile.id,
    cloneResult.providerVoiceId,
  );
  if (readyResult.error) {
    return readyResult;
  }

  return { provider_voice_id: cloneResult.providerVoiceId };
}

export async function retryVoiceCloneFromStoredSample(
  supabase: SupabaseClient,
  userId: string,
): Promise<VoiceProcessResult> {
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

  const audio = await downloadStoredVoiceSample(userId);
  if (!audio) {
    return { error: "no stored voice sample" };
  }

  const { error: pendingError } = await supabase
    .from("voice_profiles")
    .update({ status: "pending", provider_voice_id: null })
    .eq("id", profile.id);

  if (pendingError) {
    return { error: pendingError.message };
  }

  const cloneResult = await runElevenLabsClone(supabase, profile.id, userId, audio);
  if (cloneResult.notConfigured) {
    return { error: cloneResult.error, notConfigured: true };
  }
  if (cloneResult.error || !cloneResult.providerVoiceId) {
    return { error: cloneResult.error ?? "voice clone failed" };
  }

  const readyResult = await markVoiceProfileReady(
    supabase,
    profile.id,
    cloneResult.providerVoiceId,
  );
  if (readyResult.error) {
    return readyResult;
  }

  return { provider_voice_id: cloneResult.providerVoiceId };
}
