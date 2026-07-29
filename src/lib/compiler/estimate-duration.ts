import { stripBreaks } from "../tts/breaks";
import type { Manifest, ManifestSegment } from "../contracts/manifest";

function countSpeakableWords(text: string): number {
  const { cleanText } = stripBreaks(text);
  return cleanText.trim().split(/\s+/).filter(Boolean).length;
}

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

export const COMPILE_LENGTH_MIN_RATIO = 0.92;

export function isCompileEstimateUnderfilled(
  estimatedSec: number,
  targetSec: number,
  minRatio = COMPILE_LENGTH_MIN_RATIO,
): boolean {
  if (targetSec <= 0) return false;
  return estimatedSec < targetSec * minRatio;
}

export function formatLengthExpandRetryMessage(args: {
  estimatedSec: number;
  targetSec: number;
  thetaSteps: Array<{ step: number; target_words: number }>;
  segments: ReadonlyArray<Pick<ManifestSegment, "phase" | "step" | "text">>;
}): string {
  const shortSec = Math.max(0, args.targetSec - args.estimatedSec);
  const shortMin = (shortSec / 60).toFixed(1);
  const targetMin = (args.targetSec / 60).toFixed(0);
  const estimatedMin = (args.estimatedSec / 60).toFixed(1);

  const shortSteps: string[] = [];
  for (const timing of args.thetaSteps) {
    const words = args.segments
      .filter((s) => s.phase === "theta" && s.step === timing.step)
      .reduce((acc, s) => acc + countSpeakableWords(s.text), 0);
    const need = Math.max(0, timing.target_words - words);
    if (need > 20 || words < timing.target_words * 0.85) {
      shortSteps.push(
        `step ${timing.step}: ~${words} words now, target ~${timing.target_words} (add ~${Math.max(need, Math.ceil(timing.target_words * 0.15))} words)`,
      );
    }
  }

  const stepBlock =
    shortSteps.length > 0
      ? shortSteps.join("\n")
      : "Expand every theta step with richer sensory detail toward its target_words.";

  return [
    `LENGTH UNDERFILL: estimated ~${estimatedMin} min vs target ${targetMin} min (about ${shortMin} min short).`,
    "Expand theta with substantive sensory content — elaboration, not filler, not breath/phase narration.",
    "Keep target_duration_sec and step structure unchanged; grow the spoken text.",
    stepBlock,
  ].join("\n");
}
