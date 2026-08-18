import { describe, expect, it } from "vitest";
import { pickBestVoiceProfile } from "./profile-select";

describe("pickBestVoiceProfile", () => {
  it("returns none when empty", () => {
    expect(pickBestVoiceProfile([])).toEqual({
      readyId: null,
      status: "none",
      profile: null,
    });
  });

  it("prefers a real ready profile over pending/failed duplicates", () => {
    const ready = {
      id: "ready-1",
      status: "ready",
      provider_voice_id: "eleven-abc",
    };
    const pending = {
      id: "pending-1",
      status: "pending",
      provider_voice_id: null,
    };
    const failed = {
      id: "failed-1",
      status: "failed",
      provider_voice_id: null,
    };

    const result = pickBestVoiceProfile([pending, failed, ready]);
    expect(result.status).toBe("ready");
    expect(result.readyId).toBe("ready-1");
    expect(result.profile).toEqual(ready);
  });

  it("treats mock-clone ready as failed (not selectable)", () => {
    const result = pickBestVoiceProfile([
      {
        id: "mock-1",
        status: "ready",
        provider_voice_id: "mock-clone-xyz",
      },
    ]);
    expect(result.readyId).toBeNull();
    expect(result.status).toBe("failed");
  });

  it("surfaces pending when that is the best available", () => {
    const pending = {
      id: "pending-1",
      status: "pending",
      provider_voice_id: null,
    };
    expect(pickBestVoiceProfile([pending])).toEqual({
      readyId: null,
      status: "pending",
      profile: pending,
    });
  });
});
