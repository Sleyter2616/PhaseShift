import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { dedupeKey } from "./dedupe";

describe("dedupeKey fixed vector", () => {
  it("matches independently computed sha256", () => {
    const input = {
      assetScope: "user" as const,
      voiceId: "voice_abc123",
      modelId: "eleven_flash_v2_5",
      settings: { stability: 0.5, speed: 1.0 },
      text: "You are seated. The protocol begins now.",
    };

    const canonical = JSON.stringify({ speed: 1, stability: 0.5 });
    const payload = `user|voice_abc123|eleven_flash_v2_5|${canonical}|You are seated. The protocol begins now.`;
    const expected = createHash("sha256").update(payload, "utf8").digest("hex");

    expect(dedupeKey(input)).toBe(expected);
  });
});
