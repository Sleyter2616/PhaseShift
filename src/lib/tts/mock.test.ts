import { describe, expect, it } from "vitest";
import { MockTTSProvider } from "./mock";

describe("MockTTSProvider", () => {
  it("returns zeroed audio and duration from word count / wpm", async () => {
    const provider = new MockTTSProvider(120);
    const result = await provider.synthesize({
      text: "one two three four five six",
      voiceId: "v1",
      modelId: "mock",
      settings: {},
    });

    expect(result.audio).toEqual(new Uint8Array(0));
    expect(result.durationSec).toBeCloseTo(3, 5);
  });

  it("exposes selfhost id and does not support inline breaks", () => {
    const provider = new MockTTSProvider();
    expect(provider.id).toBe("selfhost");
    expect(provider.supportsInlineBreaks).toBe(false);
  });

  it("adds break durations via stripBreaks to spoken duration", async () => {
    const provider = new MockTTSProvider(120);
    const result = await provider.synthesize({
      text: 'one two three <break time="2.0s"/> four five six',
      voiceId: "v1",
      modelId: "mock",
      settings: {},
    });

    expect(result.durationSec).toBeCloseTo(3 + 2, 5);
  });
});
