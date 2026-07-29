import type { Manifest, ManifestSegment } from "../contracts/manifest";
import type { CompilerInput } from "../session/derive";
import {
  BREATH_CUES,
  type CountedBeat,
  type CountedSequence,
  type SessionSkeleton,
} from "./skeleton";

const COUNT_WORDS: Record<number, string> = {
  1: "One.",
  2: "Two.",
  3: "Three.",
  4: "Four.",
  5: "Five.",
  6: "Six.",
  7: "Seven.",
  8: "Eight.",
  9: "Nine.",
  10: "Ten.",
};

/** Spoken cue for a beat. Pause beats have no cue (pure silence). */
export function spokenCueForBeat(beat: CountedBeat): string | null {
  if (beat.kind === "pause") return null;
  if (beat.kind === "count") {
    return COUNT_WORDS[beat.n] ?? `${beat.n}.`;
  }
  if (beat.kind === "inhale") return BREATH_CUES.inhale;
  if (beat.kind === "hold") return BREATH_CUES.hold;
  if (beat.kind === "exhale") return BREATH_CUES.exhale;
  return null;
}

/**
 * Expand a counted sequence into micro-segments paced by pause_after_ms
 * (real silence), not inline <break> tags.
 *
 * Pause beats are NOT spoken — their duration is folded into the previous
 * spoken beat's pause_after_ms so silence is pure (no "Rest." / pause labels).
 * Count beats speak only the number.
 */
export function expandCountedSequenceToMicroSegments(
  sequence: CountedSequence,
  phase: "alpha" | "gamma",
  pacing_wpm: number,
): ManifestSegment[] {
  const segments: ManifestSegment[] = [];

  for (const beat of sequence.beats) {
    if (beat.kind === "pause") {
      const prev = segments.at(-1);
      if (prev) {
        prev.pause_after_ms += beat.sec * 1000;
        prev.target_duration_sec += beat.sec;
      }
      continue;
    }

    const text = spokenCueForBeat(beat);
    if (text == null) continue;

    segments.push({
      seq: segments.length + 1, // renumbered by caller
      phase,
      step: null,
      title: `counted:${sequence.kind}:${beat.kind}`,
      perspective: "second" as const,
      temporal_horizon: null,
      archetype: null,
      pacing_wpm,
      // Budget slot equals the silent beat; cue speech is short and rides inside it.
      target_duration_sec: beat.sec,
      pause_after_ms: beat.sec * 1000,
      text,
    });
  }

  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalePhaseTargets(
  segments: ManifestSegment[],
  budgetSec: number,
): ManifestSegment[] {
  if (segments.length === 0) return segments;
  const sum = segments.reduce((acc, s) => acc + s.target_duration_sec, 0);
  if (sum <= 0 || sum === budgetSec) return segments;

  const scaled = segments.map((segment) => ({
    ...segment,
    target_duration_sec: Math.max(1, Math.round((segment.target_duration_sec * budgetSec) / sum)),
  }));
  const drift = budgetSec - scaled.reduce((acc, s) => acc + s.target_duration_sec, 0);
  const longest = scaled.reduce((best, s) =>
    s.target_duration_sec > best.target_duration_sec ? s : best,
  );
  longest.target_duration_sec = Math.max(1, longest.target_duration_sec + drift);
  return scaled;
}

/**
 * Splice server-owned counted-sequence micro-segments into alpha/gamma.
 * Alpha: countdown only (breath is model-written self-paced instruction).
 * Gamma: energizing + countup. Model content is rescaled around reserved budget.
 */
export function spliceCountedSequenceSegments(
  raw: unknown,
  input: CompilerInput,
): { manifest: unknown; actions: string[] } {
  const actions: string[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.segments)) {
    return { manifest: raw, actions };
  }

  const skeleton: SessionSkeleton = input.skeleton;
  const meta = isRecord(raw.meta) ? raw.meta : {};
  const phaseBudget = input.session.phase_budget_sec;
  const pacing = input.session.pacing;

  const existing = (raw.segments as unknown[]).filter(isRecord) as unknown as ManifestSegment[];

  const alphaCountdown = expandCountedSequenceToMicroSegments(
    skeleton.counted_sequences.alpha_countdown,
    "alpha",
    pacing.alpha_wpm,
  );
  const gammaEnergizing = expandCountedSequenceToMicroSegments(
    skeleton.counted_sequences.gamma_energizing,
    "gamma",
    pacing.gamma_wpm,
  );
  const gammaCountup = expandCountedSequenceToMicroSegments(
    skeleton.counted_sequences.gamma_countup,
    "gamma",
    pacing.gamma_wpm,
  );

  const reservedAlpha = skeleton.counted_sequences.alpha_countdown.total_sec;
  const reservedGamma =
    skeleton.counted_sequences.gamma_energizing.total_sec +
    skeleton.counted_sequences.gamma_countup.total_sec;

  const modelAlpha = existing.filter((s) => s.phase === "alpha");
  const modelGamma = existing.filter((s) => s.phase === "gamma");
  const other = existing.filter((s) => s.phase !== "alpha" && s.phase !== "gamma");

  const alphaRemain = Math.max(0, phaseBudget.alpha - reservedAlpha);
  const gammaRemain = Math.max(0, phaseBudget.gamma - reservedGamma);

  const scaledAlpha =
    alphaRemain <= 0
      ? []
      : modelAlpha.length > 0
        ? scalePhaseTargets(modelAlpha, alphaRemain)
        : [
            {
              seq: 1,
              phase: "alpha" as const,
              step: null,
              title: "Deepen",
              perspective: "second" as const,
              temporal_horizon: null,
              archetype: null,
              pacing_wpm: pacing.alpha_wpm,
              target_duration_sec: alphaRemain,
              pause_after_ms: 500,
              text: "You settle deeper into ease.",
            },
          ];

  const scaledGamma =
    gammaRemain <= 0
      ? []
      : modelGamma.length > 0
        ? scalePhaseTargets(modelGamma, gammaRemain)
        : [
            {
              seq: 1,
              phase: "gamma" as const,
              step: null,
              title: "Activate",
              perspective: "second" as const,
              temporal_horizon: null,
              archetype: null,
              pacing_wpm: pacing.gamma_wpm,
              target_duration_sec: gammaRemain,
              pause_after_ms: 500,
              text: "You bring this energy into the next action.",
            },
          ];

  const segments: ManifestSegment[] = [
    ...other.filter((s) => s.phase === "beta"),
    ...scaledAlpha,
    ...alphaCountdown,
    ...other.filter((s) => s.phase === "theta"),
    ...gammaEnergizing,
    ...scaledGamma,
    ...gammaCountup,
  ].map((segment, index) => ({
    ...segment,
    seq: index + 1,
    step: segment.phase === "theta" ? segment.step : null,
  }));

  actions.push(
    `spliced counted sequences: alpha_countdown=${alphaCountdown.length}, gamma_energizing=${gammaEnergizing.length}, gamma_countup=${gammaCountup.length}`,
  );

  const manifest: Manifest = {
    meta: {
      goal_version_id: String(meta.goal_version_id ?? input.goal_version_id),
      total_duration_sec: Number(meta.total_duration_sec ?? input.skeleton.length_min * 60),
      phase_budget_sec: phaseBudget,
      entrainment_plan: input.session.entrainment_plan as Manifest["meta"]["entrainment_plan"],
    },
    segments,
  };

  return { manifest, actions };
}
