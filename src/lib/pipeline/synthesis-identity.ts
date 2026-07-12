import type { AssetScope } from "../tts/dedupe";
import type { TtsProviderId } from "../tts/provider";
import type { ServiceClient } from "../db/service-client";

export interface SynthesisIdentity {
  provider: TtsProviderId;
  assetScope: AssetScope;
  voiceId: string;
  modelId: string;
  settings: Record<string, unknown>;
  storageScopeKey: string;
}

export interface ScriptVoiceSource {
  provider: TtsProviderId;
  user_id: string;
  stock_voice_id: string | null;
  voice_profile_id: string | null;
  provider_voice_id?: string | null;
  tts_model_id: string | null;
}

export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

export const DEFAULT_VOICE_SETTINGS: Record<string, unknown> = {
  stability: 0.5,
  similarity_boost: 0.75,
};

export function defaultTtsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL_ID;
}

export function defaultTtsProvider(): TtsProviderId {
  const raw = process.env.TTS_PROVIDER ?? "elevenlabs";
  if (raw === "elevenlabs" || raw === "selfhost") return raw;
  throw new Error(`unsupported TTS_PROVIDER: ${raw}`);
}

export function resolveSynthesisIdentity(script: ScriptVoiceSource): SynthesisIdentity {
  const modelId = script.tts_model_id ?? defaultTtsModelId();
  const provider = script.provider;

  if (script.voice_profile_id) {
    if (!script.provider_voice_id) {
      throw new Error("voice profile missing provider_voice_id");
    }
    return {
      provider,
      assetScope: "user",
      voiceId: script.provider_voice_id,
      modelId,
      settings: DEFAULT_VOICE_SETTINGS,
      storageScopeKey: script.user_id,
    };
  }

  if (!script.stock_voice_id) {
    throw new Error("script must have stock_voice_id or voice_profile_id");
  }

  return {
    provider,
    assetScope: "shared",
    voiceId: script.stock_voice_id,
    modelId,
    settings: DEFAULT_VOICE_SETTINGS,
    storageScopeKey: script.stock_voice_id,
  };
}

export function buildStoragePath(identity: SynthesisIdentity, audioFileId: string): string {
  if (identity.assetScope === "shared") {
    return `shared/${identity.storageScopeKey}/${audioFileId}.mp3`;
  }
  return `${identity.storageScopeKey}/${audioFileId}.mp3`;
}

export async function loadScriptSynthesisIdentity(
  supabase: ServiceClient,
  script: ScriptVoiceSource,
): Promise<SynthesisIdentity> {
  if (!script.voice_profile_id) {
    return resolveSynthesisIdentity(script);
  }

  if (script.provider_voice_id) {
    return resolveSynthesisIdentity(script);
  }

  const { data: profile, error } = await supabase
    .from("voice_profiles")
    .select("provider_voice_id")
    .eq("id", script.voice_profile_id)
    .single();

  if (error || !profile?.provider_voice_id) {
    throw new Error(
      `voice profile missing provider_voice_id: ${error?.message ?? script.voice_profile_id}`,
    );
  }

  return resolveSynthesisIdentity({
    ...script,
    provider_voice_id: profile.provider_voice_id,
  });
}
