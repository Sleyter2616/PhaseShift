import { describe, expect, it } from "vitest";
import {
  buildStoragePath,
  resolveSynthesisIdentity,
} from "./synthesis-identity";

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

  it("uses user scope for voice profiles", () => {
    const identity = resolveSynthesisIdentity({
      provider: "elevenlabs",
      user_id: "user-1",
      stock_voice_id: null,
      voice_profile_id: "profile-uuid",
      tts_model_id: "eleven_flash_v2_5",
    });

    expect(identity.assetScope).toBe("user");
    expect(identity.voiceId).toBe("profile-uuid");
    expect(buildStoragePath(identity, "audio-1")).toBe("user-1/audio-1.mp3");
  });
});
