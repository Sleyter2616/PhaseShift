import { describe, expect, it } from "vitest";
import {
  buildVoiceRecorderOptions,
  pickRecorderMimeType,
  VOICE_RECORDING_BITS_PER_SECOND,
} from "./recorder-config";

describe("recorder-config", () => {
  it("prefers opus webm when supported", () => {
    const supported = new Set(["audio/webm", "audio/webm;codecs=opus"]);
    expect(
      pickRecorderMimeType((mime) => supported.has(mime)),
    ).toBe("audio/webm;codecs=opus");
  });

  it("falls back through mime candidates", () => {
    expect(pickRecorderMimeType((mime) => mime === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMimeType(() => false)).toBe("");
  });

  it("pins recording bitrate at 128kbps", () => {
    const options = buildVoiceRecorderOptions(() => true);
    expect(options.audioBitsPerSecond).toBe(VOICE_RECORDING_BITS_PER_SECOND);
    expect(options.audioBitsPerSecond).toBe(128_000);
  });
});
