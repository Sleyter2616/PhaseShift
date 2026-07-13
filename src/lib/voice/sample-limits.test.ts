import { describe, expect, it } from "vitest";
import {
  validateVoiceSampleUpload,
  VOICE_SAMPLE_MAX_BYTES,
  VOICE_SAMPLE_MAX_DURATION_SEC,
  VOICE_SAMPLE_MIN_DURATION_SEC,
} from "./sample-limits";

describe("validateVoiceSampleUpload", () => {
  it("rejects empty audio", () => {
    expect(validateVoiceSampleUpload({ byteLength: 0 })).toBe("missing audio sample");
  });

  it("rejects samples over 10MB", () => {
    expect(
      validateVoiceSampleUpload({ byteLength: VOICE_SAMPLE_MAX_BYTES + 1 }),
    ).toMatch(/10MB/);
  });

  it("rejects duration under 80s when metadata is present", () => {
    expect(
      validateVoiceSampleUpload({ byteLength: 1_500_000, durationSec: 45 }),
    ).toBe(`recording too short (45s); minimum ${VOICE_SAMPLE_MIN_DURATION_SEC}s`);
  });

  it("rejects duration over 180s when metadata is present", () => {
    expect(
      validateVoiceSampleUpload({ byteLength: 1_500_000, durationSec: 181 }),
    ).toBe(`recording too long (181s); maximum ${VOICE_SAMPLE_MAX_DURATION_SEC}s`);
  });

  it("accepts valid sample without duration metadata", () => {
    expect(validateVoiceSampleUpload({ byteLength: 1_500_000 })).toBeNull();
  });

  it("accepts valid sample with sufficient duration", () => {
    expect(
      validateVoiceSampleUpload({ byteLength: 1_500_000, durationSec: 90 }),
    ).toBeNull();
  });
});
