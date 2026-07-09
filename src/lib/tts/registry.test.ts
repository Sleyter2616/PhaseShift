import { describe, expect, it } from "vitest";
import { getProvider } from "./registry";

describe("getProvider", () => {
  it("returns selfhost mock provider", () => {
    const provider = getProvider("selfhost", { pacingWpm: 120 });
    expect(provider.id).toBe("selfhost");
    expect(provider.supportsInlineBreaks).toBe(false);
  });

  it("throws when elevenlabs is requested without API key", () => {
    const prior = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => getProvider("elevenlabs")).toThrow(/ELEVENLABS_API_KEY/);
    if (prior) process.env.ELEVENLABS_API_KEY = prior;
  });
});
