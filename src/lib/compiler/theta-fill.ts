import { PACING_WPM } from "../costs";
import type { Manifest, ManifestSegment } from "../contracts/manifest";
import { stripBreaks } from "../tts/breaks";
import type { SessionSkeleton, ThetaStepTiming } from "./skeleton";
import { STEP_NAMES } from "./skeleton";

/** Theta speech must reach at least this fraction of the word budget. */
export const THETA_WORD_FILL_MIN_RATIO = 0.85;

/** Modest contemplative pause between theta steps (not a budget-fill mechanism). */
export const THETA_REFLECTIVE_PAUSE_MS = 4_000;

export function countSpeakableWords(text: string): number {
  const { cleanText } = stripBreaks(text);
  return cleanText.trim().split(/\s+/).filter(Boolean).length;
}

export function thetaWordBudget(targetSec: number, pacingWpm: number = PACING_WPM.theta): number {
  return (pacingWpm * targetSec) / 60;
}

export function thetaMinWords(targetSec: number, pacingWpm: number = PACING_WPM.theta): number {
  return Math.ceil(THETA_WORD_FILL_MIN_RATIO * thetaWordBudget(targetSec, pacingWpm));
}

export type ThetaStepBudget = ThetaStepTiming & {
  name: string;
  target_words: number;
  min_words: number;
};

/** Per-step targets with explicit word floors for the model prompt. */
export function formatThetaStepsForPrompt(
  thetaSteps: ThetaStepTiming[],
  pacingWpm: number = PACING_WPM.theta,
): ThetaStepBudget[] {
  return thetaSteps.map((timing) => ({
    ...timing,
    name: STEP_NAMES[timing.step] ?? `Step ${timing.step}`,
    target_words: Math.round(thetaWordBudget(timing.target_sec, pacingWpm)),
    min_words: thetaMinWords(timing.target_sec, pacingWpm),
  }));
}

export interface ThetaStepFillStatus {
  step: number;
  targetSec: number;
  sumTargetSec: number;
  words: number;
  minWords: number;
  underfilled: boolean;
  durationMismatch: boolean;
}

export function assessThetaStepFill(
  segments: ReadonlyArray<Pick<ManifestSegment, "phase" | "step" | "target_duration_sec" | "text">>,
  timing: ThetaStepTiming,
  pacingWpm: number = PACING_WPM.theta,
): ThetaStepFillStatus {
  const stepSegs = segments.filter((s) => s.phase === "theta" && s.step === timing.step);
  const sumTargetSec = stepSegs.reduce((acc, s) => acc + s.target_duration_sec, 0);
  const words = stepSegs.reduce((acc, s) => acc + countSpeakableWords(s.text), 0);
  const minWords = thetaMinWords(timing.target_sec, pacingWpm);
  return {
    step: timing.step,
    targetSec: timing.target_sec,
    sumTargetSec,
    words,
    minWords,
    underfilled: words < minWords,
    durationMismatch: sumTargetSec !== timing.target_sec,
  };
}

/**
 * Hard errors when theta step durations or word fill fall short of the skeleton.
 * Used at compile time to trigger retry with expansion instructions.
 */
export function collectThetaFillErrors(
  manifest: Manifest,
  skeleton: SessionSkeleton,
  pacingWpm: number = PACING_WPM.theta,
): string[] {
  const errors: string[] = [];
  const thetaSegments = manifest.segments.filter((s) => s.phase === "theta");
  const thetaSum = thetaSegments.reduce((acc, s) => acc + s.target_duration_sec, 0);
  const expectedTheta = skeleton.phase_budget.theta_sec;

  if (Math.abs(thetaSum - expectedTheta) > 0) {
    errors.push(
      `theta target sum ${thetaSum} !== skeleton theta_sec ${expectedTheta}`,
    );
  }

  for (const timing of skeleton.theta_steps) {
    const status = assessThetaStepFill(manifest.segments, timing, pacingWpm);
    if (status.durationMismatch) {
      errors.push(
        `theta step ${timing.step} (${STEP_NAMES[timing.step] ?? "?"}): target_duration sum ${status.sumTargetSec} !== skeleton target_sec ${timing.target_sec}`,
      );
    }
    if (status.underfilled) {
      errors.push(
        `theta step ${timing.step} (${STEP_NAMES[timing.step] ?? "?"}) UNDERFILLED: ${status.words} words < min ${status.minWords} (need ≥${Math.round(THETA_WORD_FILL_MIN_RATIO * 100)}% of ${Math.round(thetaWordBudget(timing.target_sec, pacingWpm))} word budget for ${timing.target_sec}s at ${pacingWpm} wpm). Expand with substantive sensory detail, declarations, and rehearsal — do not pad with silence.`,
      );
    }
  }

  return errors;
}

export function formatThetaExpansionRetryMessage(errors: string[]): string {
  return [
    "THETA UNDERFILL / DURATION MISMATCH — expand the short steps with RICH substantive content.",
    "Do NOT change target_duration_sec values or drop steps. Meet each step's min_words floor.",
    "Pauses are contemplative (≤4s between steps), not a substitute for speech.",
    ...errors,
  ].join("\n");
}

/**
 * Stamp modest reflective pause_after_ms on the last segment of each theta
 * step except the final step (before gamma). Does not inflate beyond the cap.
 */
export function stampThetaReflectivePauses<
  T extends Pick<ManifestSegment, "seq" | "phase" | "step" | "pause_after_ms">,
>(segments: T[]): { segments: T[]; actions: string[] } {
  const actions: string[] = [];
  const next = segments.map((s) => ({ ...s }));
  const thetaIndices = next
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.phase === "theta" && segment.step != null);

  for (let i = 0; i < thetaIndices.length; i += 1) {
    const current = thetaIndices[i]!;
    const following = thetaIndices[i + 1];
    const isLastOfStep =
      !following || following.segment.step !== current.segment.step;
    const isFinalThetaStep = !following;
    if (!isLastOfStep || isFinalThetaStep) continue;

    const seg = next[current.index]!;
    if (seg.pause_after_ms < THETA_REFLECTIVE_PAUSE_MS) {
      actions.push(
        `seq ${seg.seq}: stamped reflective pause_after_ms ${seg.pause_after_ms}->${THETA_REFLECTIVE_PAUSE_MS}`,
      );
      seg.pause_after_ms = THETA_REFLECTIVE_PAUSE_MS;
    } else if (seg.pause_after_ms > THETA_REFLECTIVE_PAUSE_MS) {
      // Cap contemplative pauses at the reflective max (global 5s cap still applies at reconcile).
      actions.push(
        `seq ${seg.seq}: capped reflective pause_after_ms ${seg.pause_after_ms}->${THETA_REFLECTIVE_PAUSE_MS}`,
      );
      seg.pause_after_ms = THETA_REFLECTIVE_PAUSE_MS;
    }
  }

  return { segments: next, actions };
}
