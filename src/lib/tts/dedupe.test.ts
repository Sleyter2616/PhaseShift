import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { dedupeKey } from "./dedupe";

const FIXED_VECTOR = {
  provider: "elevenlabs" as const,
  assetScope: "user" as const,
  voiceId: "voice_abc123",
  modelId: "eleven_flash_v2_5",
  settings: { stability: 0.5, speed: 1.0 },
  text: "You are seated. The protocol begins now.",
};

const EXPECTED_HASH =
  "6f80ec4ba1e78a848d54e6fee9c264f25bc8a26dd043cfb5c51bb5c1b407ff41";

describe("dedupeKey fixed vector", () => {
  it("matches independently computed sha256 (A3 provider prefix)", () => {
    const canonical = JSON.stringify({ speed: 1, stability: 0.5 });
    const payload = `elevenlabs|user|voice_abc123|eleven_flash_v2_5|${canonical}|You are seated. The protocol begins now.`;
    const expected = createHash("sha256").update(payload, "utf8").digest("hex");

    expect(dedupeKey(FIXED_VECTOR)).toBe(expected);
    expect(dedupeKey(FIXED_VECTOR)).toBe(EXPECTED_HASH);
  });

  it("canonicalizes settings key order", () => {
    const recomputed = dedupeKey({
      ...FIXED_VECTOR,
      settings: { speed: 1.0, stability: 0.5 },
    });
    expect(recomputed).toBe(EXPECTED_HASH);
  });
});
