import { describe, expect, it } from "vitest";
import {
  isMockProviderVoiceId,
  isRealReadyProfile,
  VOICE_CLONING_NOT_CONFIGURED,
} from "./process-voice-sample";

describe("voice profile helpers", () => {
  it("detects mock provider voice ids", () => {
    expect(isMockProviderVoiceId("mock-clone-abc12345")).toBe(true);
    expect(isMockProviderVoiceId("real-eleven-voice-id")).toBe(false);
    expect(isMockProviderVoiceId(null)).toBe(false);
  });

  it("treats mock-ready profiles as not truly ready", () => {
    expect(
      isRealReadyProfile({
        status: "ready",
        provider_voice_id: "mock-clone-deadbeef",
      }),
    ).toBe(false);
    expect(
      isRealReadyProfile({
        status: "ready",
        provider_voice_id: "eleven-voice-abc",
      }),
    ).toBe(true);
  });

  it("exports the not-configured error string", () => {
    expect(VOICE_CLONING_NOT_CONFIGURED).toBe("voice cloning not configured");
  });
});
