import type { CompilerInput } from "../session/derive";
import type { ManifestSegment } from "../contracts/manifest";
import { stampThetaReflectivePauses } from "./theta-fill";

const PHASES = ["beta", "alpha", "theta", "gamma", "delta"] as const;
type Phase = (typeof PHASES)[number];

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PauseStampable = Pick<ManifestSegment, "seq" | "phase" | "step" | "pause_after_ms"> &
  Record<string, unknown>;

function isPauseStampable(value: unknown): value is PauseStampable {
  return (
    isRecord(value) &&
    typeof value.seq === "number" &&
    typeof value.phase === "string" &&
    (value.step === null || typeof value.step === "number") &&
    typeof value.pause_after_ms === "number"
  );
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
    const paused = stampThetaReflectivePauses(stampedSegments);
    stampedSegments = paused.segments;
    actions.push(...paused.actions);
  }

  draft.segments = stampedSegments;
  actions.push(`stamped seq + pacing_wpm on ${stampedSegments.length} segment(s)`);
  return { manifest: draft, actions };
}

/** Narrow helper for tests — extract stamped seq list. */
export function stampedSeqs(manifest: { segments: Array<Pick<ManifestSegment, "seq">> }): number[] {
  return manifest.segments.map((s) => s.seq);
}
