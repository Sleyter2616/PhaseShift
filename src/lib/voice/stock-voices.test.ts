import { describe, expect, it } from "vitest";
import {
  isAllowedStockVoiceId,
  stockVoiceOptionsFromEnv,
} from "./stock-voices";

describe("stock voices", () => {
  it("prefers male/female env voices", () => {
    expect(
      stockVoiceOptionsFromEnv({
        ELEVENLABS_STOCK_VOICE_MALE: "voice_male",
        ELEVENLABS_STOCK_VOICE_FEMALE: "voice_female",
        ELEVENLABS_STOCK_VOICE_ID: "voice_legacy",
      }),
    ).toEqual([
      { id: "voice_male", label: "Stock voice (male)", key: "male" },
      { id: "voice_female", label: "Stock voice (female)", key: "female" },
    ]);
  });

  it("falls back to legacy stock voice id", () => {
    expect(
      stockVoiceOptionsFromEnv({
        ELEVENLABS_STOCK_VOICE_ID: "voice_legacy",
      }),
    ).toEqual([{ id: "voice_legacy", label: "Stock voice", key: "default" }]);
  });

  it("validates allowed stock voice ids", () => {
    const env = {
      ELEVENLABS_STOCK_VOICE_MALE: "voice_male",
      ELEVENLABS_STOCK_VOICE_FEMALE: "voice_female",
    };
    expect(isAllowedStockVoiceId("voice_male", env)).toBe(true);
    expect(isAllowedStockVoiceId("unknown", env)).toBe(false);
  });
});
