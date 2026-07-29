/**
 * Session playback mix levels — voice is always the foreground;
 * entrainment tone is a continuous bed that must stay quieter.
 *
 * Continuous AM/binaural tones are perceptually louder than intermittent
 * speech at equal gain, so the tone gain range is intentionally small.
 */

/** Voice gain: full scale, default unity. */
export const VOICE_GAIN_MIN = 0;
export const VOICE_GAIN_MAX = 1;
export const VOICE_GAIN_DEFAULT = 1;

/**
 * Tone gain: usable full-slider range under the voice.
 * Max ~0.15 keeps even "100%" as a bed; default ~0.08 sits mid-slider.
 */
export const TONE_GAIN_MIN = 0;
export const TONE_GAIN_MAX = 0.15;
export const TONE_GAIN_DEFAULT = 0.08;

/** Tone stays well below voice at every slider position when voice is at default. */
export function toneIsUnderVoice(
  toneGain: number,
  voiceGain: number = VOICE_GAIN_DEFAULT,
): boolean {
  return toneGain < voiceGain && toneGain <= TONE_GAIN_MAX;
}
