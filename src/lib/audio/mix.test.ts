import { describe, expect, it } from "vitest";
import {
  TONE_GAIN_DEFAULT,
  TONE_GAIN_MAX,
  TONE_GAIN_MIN,
  VOICE_GAIN_DEFAULT,
  VOICE_GAIN_MAX,
  toneIsUnderVoice,
} from "./mix";

describe("session mix levels", () => {
  it("caps tone slider at <= 0.15 so the full range stays usable", () => {
    expect(TONE_GAIN_MAX).toBeLessThanOrEqual(0.15);
    expect(TONE_GAIN_MAX).toBeGreaterThan(TONE_GAIN_DEFAULT);
    expect(TONE_GAIN_MIN).toBe(0);
  });

  it("defaults tone well below voice, mid-slider so users can go up or down", () => {
    expect(VOICE_GAIN_DEFAULT).toBe(1);
    expect(VOICE_GAIN_MAX).toBe(1);
    expect(TONE_GAIN_DEFAULT).toBeLessThan(VOICE_GAIN_DEFAULT);
    expect(TONE_GAIN_DEFAULT).toBeLessThanOrEqual(TONE_GAIN_MAX);
    // Default near the middle of the tone range (room both ways).
    const mid = (TONE_GAIN_MIN + TONE_GAIN_MAX) / 2;
    expect(Math.abs(TONE_GAIN_DEFAULT - mid) / TONE_GAIN_MAX).toBeLessThan(0.25);
  });

  it("keeps tone under voice at every tone slider position with default voice", () => {
    for (let t = TONE_GAIN_MIN; t <= TONE_GAIN_MAX + 1e-9; t += 0.01) {
      const tone = Math.min(t, TONE_GAIN_MAX);
      expect(toneIsUnderVoice(tone, VOICE_GAIN_DEFAULT)).toBe(true);
      expect(tone).toBeLessThan(VOICE_GAIN_DEFAULT);
    }
    expect(toneIsUnderVoice(TONE_GAIN_MAX, VOICE_GAIN_DEFAULT)).toBe(true);
    expect(toneIsUnderVoice(TONE_GAIN_DEFAULT, VOICE_GAIN_DEFAULT)).toBe(true);
  });
});
