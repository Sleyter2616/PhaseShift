import type { CompilerInput } from "../session/derive";
import type { ManifestSegment } from "../contracts/manifest";
import { REFLECTIVE_PAUSE_MS } from "./skeleton";

/** Extra silence after opening (beta / early alpha) segments so entry feels unhurried. */
export const OPENING_SETTLE_PAUSE_MS = 7_000;

const PHASES = ["beta", "alpha", "theta", "gamma", "delta"] as const;
type Phase = (typeof PHASES)[number];

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PauseStampable = {
  seq: number;
  phase: string;
  step: number | null;
  pause_after_ms: number;
};

function isPauseStampable(value: unknown): value is PauseStampable & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.seq === "number" &&
    typeof value.phase === "string" &&
    (value.step === null || typeof value.step === "number") &&
    typeof value.pause_after_ms === "number"
  );
}

/**
 * Stamp reflective pauses from skeleton.depth:
 * - Between steps: last segment of each theta step (except final Closure)
 * - Within steps (depth > 1): non-final segments inside a multi-segment step
 */
export function stampThetaReflectivePausesFromDepth(
  segments: Array<PauseStampable & Record<string, unknown>>,
  input: CompilerInput,
): { segments: Array<PauseStampable & Record<string, unknown>>; actions: string[] } {
  const actions: string[] = [];
  const plan = input.skeleton.depth.reflective_pauses;
  const betweenMs = plan.between_step_ms || REFLECTIVE_PAUSE_MS;
  const withinMs = plan.within_step_ms;
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
    const seg = next[current.index]!;

    if (!isLastOfStep && withinMs > 0) {
      if (seg.pause_after_ms < withinMs) {
        actions.push(
          `seq ${seg.seq}: stamped within-step reflective pause_after_ms ${seg.pause_after_ms}->${withinMs}`,
        );
        seg.pause_after_ms = withinMs;
      }
      continue;
    }

    if (isLastOfStep && !isFinalThetaStep && betweenMs > 0) {
      if (seg.pause_after_ms < betweenMs) {
        actions.push(
          `seq ${seg.seq}: stamped between-step reflective pause_after_ms ${seg.pause_after_ms}->${betweenMs}`,
        );
        seg.pause_after_ms = betweenMs;
      } else if (seg.pause_after_ms > betweenMs) {
        actions.push(
          `seq ${seg.seq}: capped between-step reflective pause_after_ms ${seg.pause_after_ms}->${betweenMs}`,
        );
        seg.pause_after_ms = betweenMs;
      }
    }
  }

  return { segments: next, actions };
}

/**
 * Stamp settle pauses on beta and the first early-alpha content segment so the
 * opening is unhurried before the progressive body scan.
 */
export function stampOpeningSettlePauses(
  segments: Array<PauseStampable & Record<string, unknown>>,
): { segments: Array<PauseStampable & Record<string, unknown>>; actions: string[] } {
  const actions: string[] = [];
  const next = segments.map((s) => ({ ...s }));
  let stampedFirstAlpha = false;

  for (const seg of next) {
    if (seg.phase === "beta" && seg.pause_after_ms < OPENING_SETTLE_PAUSE_MS) {
      actions.push(
        `seq ${seg.seq}: stamped opening settle pause_after_ms ${seg.pause_after_ms}->${OPENING_SETTLE_PAUSE_MS}`,
      );
      seg.pause_after_ms = OPENING_SETTLE_PAUSE_MS;
    }
    if (seg.phase === "alpha" && !stampedFirstAlpha) {
      stampedFirstAlpha = true;
      if (seg.pause_after_ms < OPENING_SETTLE_PAUSE_MS) {
        actions.push(
          `seq ${seg.seq}: stamped early-alpha settle pause_after_ms ${seg.pause_after_ms}->${OPENING_SETTLE_PAUSE_MS}`,
        );
        seg.pause_after_ms = OPENING_SETTLE_PAUSE_MS;
      }
    }
  }

  return { segments: next, actions };
}

/**
 * Stamp server-owned skeleton/session fields onto a model-emitted draft
 * before normalize + validate. The model supplies segment content; the
 * server owns duration totals, entrainment, seq, and pacing_wpm.
 */
export function injectServerOwnedFields(
  raw: unknown,
  input: CompilerInput,
): { manifest: unknown; actions: string[] } {
  const actions: string[] = [];

  if (!isRecord(raw)) {
    return { manifest: raw, actions };
  }

  const draft = structuredClone(raw) as Record<string, unknown>;
  const meta = isRecord(draft.meta) ? { ...draft.meta } : {};

  const totalDurationSec = input.skeleton.length_min * 60;
  meta.goal_version_id = input.goal_version_id;
  meta.total_duration_sec = totalDurationSec;
  meta.phase_budget_sec = { ...input.session.phase_budget_sec };
  meta.entrainment_plan = structuredClone(input.session.entrainment_plan);
  draft.meta = meta;
  actions.push(
    `stamped meta.total_duration_sec=${totalDurationSec}, phase_budget_sec, entrainment_plan, goal_version_id`,
  );

  const segmentsIn = draft.segments;
  if (!Array.isArray(segmentsIn)) {
    return { manifest: draft, actions };
  }

  const pacing = input.session.pacing;
  const pacingByPhase: Record<string, number> = {
    beta: pacing.beta_wpm,
    alpha: pacing.alpha_wpm,
    theta: pacing.theta_wpm,
    gamma: pacing.gamma_wpm,
    delta: pacing.theta_wpm,
  };

  let stampedSegments: unknown[] = segmentsIn.map((segment, index) => {
    if (!isRecord(segment)) return segment;

    const next: Record<string, unknown> = { ...segment };
    next.seq = index + 1;

    const phase = isPhase(next.phase) ? next.phase : null;
    if (phase) {
      next.pacing_wpm = pacingByPhase[phase] ?? pacing.theta_wpm;
      if (phase !== "theta") {
        next.step = null;
      }
    }

    return next;
  });

  if (stampedSegments.every(isPauseStampable)) {
    const paused = stampThetaReflectivePausesFromDepth(stampedSegments, input);
    const opening = stampOpeningSettlePauses(paused.segments);
    stampedSegments = opening.segments;
    actions.push(...paused.actions, ...opening.actions);
  }

  draft.segments = stampedSegments;
  actions.push(`stamped seq + pacing_wpm on ${stampedSegments.length} segment(s)`);
  return { manifest: draft, actions };
}

/** Narrow helper for tests — extract stamped seq list. */
export function stampedSeqs(manifest: { segments: Array<Pick<ManifestSegment, "seq">> }): number[] {
  return manifest.segments.map((s) => s.seq);
}
