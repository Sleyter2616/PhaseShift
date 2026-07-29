import { stripBreaks } from "../tts/breaks";
import type { Manifest, ManifestSegment } from "../contracts/manifest";

function countSpeakableWords(text: string): number {
  const { cleanText } = stripBreaks(text);
  return cleanText.trim().split(/\s+/).filter(Boolean).length;
}

export { countSpeakableWords as countManifestSpeakableWords };

/** Estimate voiced seconds from pacing (same model as MockTTS speech). */
export function estimateSegmentSpeechSec(
  segment: Pick<ManifestSegment, "text" | "pacing_wpm">,
): number {
  const { totalBreakMs } = stripBreaks(segment.text);
  const words = countSpeakableWords(segment.text);
  const wpm = Math.max(1, segment.pacing_wpm);
  return (words / wpm) * 60 + totalBreakMs / 1000;
}

/**
 * Estimate wall-clock seconds: speech + intended pauses (capped at capMs each).
 * Used as a cheap compile-time gate before paying for synthesis.
 */
export function estimateManifestWallClockSec(
  manifest: Manifest,
  pauseCapMs = 10_000,
): number {
  let total = 0;
  for (const segment of manifest.segments) {
    total += estimateSegmentSpeechSec(segment);
    total += Math.min(Math.max(0, segment.pause_after_ms), pauseCapMs) / 1000;
  }
  return total;
}

/** Content must estimate to at least this fraction of length_min*60 before synth. */
export const COMPILE_LENGTH_MIN_RATIO = 0.97;

/** How many times we recompile solely to expand underfilled theta content. */
export const MAX_LENGTH_EXPAND_RETRIES = 2;

export function isCompileEstimateUnderfilled(
  estimatedSec: number,
  targetSec: number,
  minRatio = COMPILE_LENGTH_MIN_RATIO,
): boolean {
  if (targetSec <= 0) return false;
  return estimatedSec < targetSec * minRatio;
}

export type ThetaWordShortfall = {
  step: number;
  words: number;
  target_words: number;
  short_by: number;
};

export function summarizeThetaWordShortfalls(
  thetaSteps: ReadonlyArray<{ step: number; target_words: number }>,
  segments: ReadonlyArray<Pick<ManifestSegment, "phase" | "step" | "text">>,
): ThetaWordShortfall[] {
  const out: ThetaWordShortfall[] = [];
  for (const timing of thetaSteps) {
    const words = segments
      .filter((s) => s.phase === "theta" && s.step === timing.step)
      .reduce((acc, s) => acc + countSpeakableWords(s.text), 0);
    const short_by = Math.max(0, timing.target_words - words);
    if (short_by > 0) {
      out.push({
        step: timing.step,
        words,
        target_words: timing.target_words,
        short_by,
      });
    }
  }
  return out;
}

/**
 * Telemetry: estimated wall clock vs labeled target, plus theta word gaps.
 * Distinguishes prompt-laziness (shortfalls with headroom) from calibration
 * (chronic shortfall after expand retries).
 */
export function logCompileLengthTelemetry(args: {
  estimatedSec: number;
  targetSec: number;
  attempt: number;
  lengthExpandRetries: number;
  shortfalls: ReadonlyArray<ThetaWordShortfall>;
  accepting: boolean;
}): void {
  const ratio = args.targetSec > 0 ? args.estimatedSec / args.targetSec : 0;
  const shortSec = Math.max(0, args.targetSec - args.estimatedSec);
  console.error(
    `length-telemetry: estimate=${args.estimatedSec.toFixed(1)}s target=${args.targetSec}s ` +
      `ratio=${ratio.toFixed(3)} short=${shortSec.toFixed(1)}s ` +
      `attempt=${args.attempt} expand_retries=${args.lengthExpandRetries} ` +
      `theta_short_steps=${args.shortfalls.length}` +
      (args.accepting ? " accepting=1" : ""),
  );
  if (args.shortfalls.length > 0) {
    const detail = args.shortfalls
      .map((s) => `step ${s.step}: ${s.words}/${s.target_words} (−${s.short_by})`)
      .join("; ");
    console.error(`length-telemetry theta_words: ${detail}`);
  }
}

export function formatLengthExpandRetryMessage(args: {
  estimatedSec: number;
  targetSec: number;
  thetaSteps: Array<{ step: number; target_words: number }>;
  segments: ReadonlyArray<Pick<ManifestSegment, "phase" | "step" | "text">>;
}): string {
  const estimatedMin = (args.estimatedSec / 60).toFixed(1);
  const targetMin = (args.targetSec / 60).toFixed(0);
  const shortfalls = summarizeThetaWordShortfalls(args.thetaSteps, args.segments);

  const stepList =
    shortfalls.length > 0
      ? shortfalls.map((s) => s.step).join(", ")
      : args.thetaSteps.map((t) => t.step).join(", ");

  const perStep =
    shortfalls.length > 0
      ? shortfalls
          .map(
            (s) =>
              `step ${s.step}: ~${s.words} words now, minimum ${s.target_words} (under by ${s.short_by})`,
          )
          .join("\n")
      : "Every theta step is under its minimum target_words — expand each with denser sensory detail.";

  return [
    `LENGTH UNDERFILL: Your draft totals ~${estimatedMin} minutes; target is ${targetMin}.`,
    `Theta steps [${stepList}] are under their word budgets — expand each with more sensory detail to meet its target.`,
    "Do not add steps; deepen existing ones. Keep target_duration_sec and segment/step structure unchanged.",
    "Each theta step MUST reach at least its skeleton.theta_steps[].target_words minimum.",
    perStep,
  ].join("\n");
}
