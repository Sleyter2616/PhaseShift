import { describe, expect, it } from "vitest";
import { isTestGenerationProvider, synthesisProvenanceBadge } from "./provenance";

describe("synthesisProvenanceBadge", () => {
  it('returns "test audio" for selfhost', () => {
    expect(
      synthesisProvenanceBadge({
        provider: "selfhost",
        stock_voice_id: "mock-voice",
        voice_profile_id: null,
      }),
    ).toBe("test audio");
  });

  it('returns "My voice" when a voice profile is selected', () => {
    expect(
      synthesisProvenanceBadge({
        provider: "elevenlabs",
        stock_voice_id: null,
        voice_profile_id: "profile-uuid",
      }),
    ).toBe("My voice");
  });

  it('returns "Stock voice" for elevenlabs stock path', () => {
    expect(
      synthesisProvenanceBadge({
        provider: "elevenlabs",
        stock_voice_id: "stock-abc",
        voice_profile_id: null,
      }),
    ).toBe("Stock voice");
  });
});

describe("isTestGenerationProvider", () => {
  it("detects selfhost test generations", () => {
    expect(isTestGenerationProvider("selfhost")).toBe(true);
    expect(isTestGenerationProvider("elevenlabs")).toBe(false);
  });
});
