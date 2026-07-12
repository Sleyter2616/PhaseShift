import { describe, expect, it, vi } from "vitest";
import {
  buildStoragePath,
  loadScriptSynthesisIdentity,
  resolveSynthesisIdentity,
} from "./synthesis-identity";

const PROFILE_ROW_UUID = "a1b2c3d4-e5f6-4a78-9abc-def012345678";
const ELEVEN_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

describe("loadScriptSynthesisIdentity", () => {
  it("fetches provider_voice_id and never uses the profile row uuid as voiceId", async () => {
    const script = {
      provider: "elevenlabs" as const,
      user_id: "user-1",
      stock_voice_id: null,
      voice_profile_id: PROFILE_ROW_UUID,
      tts_model_id: "eleven_flash_v2_5",
    };

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { provider_voice_id: ELEVEN_VOICE_ID },
              error: null,
            }),
          }),
        }),
      }),
    };

    const identity = await loadScriptSynthesisIdentity(supabase as never, script);

    expect(identity.voiceId).toBe(ELEVEN_VOICE_ID);
    expect(identity.voiceId).not.toBe(PROFILE_ROW_UUID);
    expect(identity.assetScope).toBe("user");
    expect(supabase.from).toHaveBeenCalledWith("voice_profiles");
  });

  it("skips profile fetch when provider_voice_id is already present", async () => {
    const script = {
      provider: "elevenlabs" as const,
      user_id: "user-1",
      stock_voice_id: null,
      voice_profile_id: PROFILE_ROW_UUID,
      provider_voice_id: ELEVEN_VOICE_ID,
      tts_model_id: "eleven_flash_v2_5",
    };

    const supabase = { from: vi.fn() };
    const identity = await loadScriptSynthesisIdentity(supabase as never, script);

    expect(identity.voiceId).toBe(ELEVEN_VOICE_ID);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("uses stock voice path without profile lookup", async () => {
    const identity = await loadScriptSynthesisIdentity({ from: vi.fn() } as never, {
      provider: "elevenlabs",
      user_id: "user-1",
      stock_voice_id: "stock-voice-abc",
      voice_profile_id: null,
      tts_model_id: "eleven_flash_v2_5",
    });

    expect(identity.voiceId).toBe("stock-voice-abc");
    expect(identity.assetScope).toBe("shared");
  });
});

describe("resolveSynthesisIdentity", () => {
  it("uses shared scope for stock voices", () => {
    const identity = resolveSynthesisIdentity({
      provider: "elevenlabs",
      user_id: "user-1",
      stock_voice_id: "stock-voice-abc",
      voice_profile_id: null,
      tts_model_id: "eleven_flash_v2_5",
    });

    expect(identity.assetScope).toBe("shared");
    expect(identity.voiceId).toBe("stock-voice-abc");
    expect(buildStoragePath(identity, "audio-1")).toBe("shared/stock-voice-abc/audio-1.mp3");
  });

  it("uses provider_voice_id for cloned voices", () => {
    const identity = resolveSynthesisIdentity({
      provider: "elevenlabs",
      user_id: "user-1",
      stock_voice_id: null,
      voice_profile_id: PROFILE_ROW_UUID,
      provider_voice_id: ELEVEN_VOICE_ID,
      tts_model_id: "eleven_flash_v2_5",
    });

    expect(identity.assetScope).toBe("user");
    expect(identity.voiceId).toBe(ELEVEN_VOICE_ID);
    expect(buildStoragePath(identity, "audio-1")).toBe("user-1/audio-1.mp3");
  });

  it("rejects profile row uuid when provider_voice_id is missing", () => {
    expect(() =>
      resolveSynthesisIdentity({
        provider: "elevenlabs",
        user_id: "user-1",
        stock_voice_id: null,
        voice_profile_id: PROFILE_ROW_UUID,
        tts_model_id: "eleven_flash_v2_5",
      }),
    ).toThrow(/provider_voice_id/);
  });
});
