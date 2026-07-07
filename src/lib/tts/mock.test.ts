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
});
