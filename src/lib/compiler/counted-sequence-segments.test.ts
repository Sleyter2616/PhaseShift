import { describe, expect, it } from "vitest";
import { buildCountedSequence, buildSessionSkeleton } from "./skeleton";
import {
  expandCountedSequenceToMicroSegments,
  spliceCountedSequenceSegments,
} from "./counted-sequence-segments";
import { reconcilePhaseTiming, MAX_SCHEDULED_PAUSE_MS } from "../schedule/reconcile";
import type { CompilerInput } from "../session/derive";
import { DEFAULT_ENTRAINMENT_PLAN } from "../session/derive";

describe("expandCountedSequenceToMicroSegments", () => {
  it("produces breath micro-segments with 4000/2000/8000/2000 pause_after_ms", () => {
    const seq = buildCountedSequence("breath", 2, 40);
    expect(seq.count).toBe(2);
    const micros = expandCountedSequenceToMicroSegments(seq, "alpha", 90);
    expect(micros).toHaveLength(8);
    const pauses = micros.map((m) => m.pause_after_ms);
    expect(pauses.slice(0, 4)).toEqual([4000, 2000, 8000, 2000]);
    expect(pauses.slice(4, 8)).toEqual([4000, 2000, 8000, 2000]);
    expect(micros.map((m) => m.text)).toEqual([
      "Breathe in.",
      "Hold.",
      "Breathe out.",
      "Rest.",
      "Breathe in.",
      "Hold.",
      "Breathe out.",
      "Rest.",
    ]);
  });
});

describe("timing regression acceptance", () => {
  it("never schedules pauses above the cap after reconcile", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 0, alpha: 360, theta: 1980, gamma: 240 },
      segments: [
        { phase: "alpha", pause_after_ms: 500, actual_duration_sec: 20 },
        { phase: "alpha", pause_after_ms: 65_705, actual_duration_sec: 15 },
        { phase: "theta", pause_after_ms: 230_340, actual_duration_sec: 40 },
        { phase: "theta", pause_after_ms: 500, actual_duration_sec: 50 },
      ],
    });
    for (const segment of result.segments) {
      expect(segment.scheduled_pause_after_ms).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
    }
  });

  it("session wall-clock stays near length without multi-minute dead air", () => {
    const skeleton = buildSessionSkeleton({ length_min: 15 });
    const input: CompilerInput = {
      goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
      raw: {
        goal_statement: "Test goal.",
        localization: { timeframe: "90d", place: "Place" },
        triangulation: ["aaaaa", "bbbbb", "ccccc"],
        not_list: ["n1", "n2"],
        wrong_direction_pulls: [],
        features: ["email one", "badge two", "paycheck three"],
        sync_actions: [{ action: "send it" }],
      },
      goal_statement: "Test goal.",
      localization: { timeframe: "ninety days", place: "Place" },
      triangulation: ["aaaaa", "bbbbb", "ccccc"],
      not_list: ["n1", "n2"],
      wrong_direction_pulls: [],
      features: ["email one", "badge two", "paycheck three"],
      sync_actions: [{ action: "send it" }],
      senses_emphasis: ["sight", "touch"],
      session: {
        duration_min: 15,
        phase_budget_sec: {
          beta: skeleton.phase_budget.beta_sec,
          alpha: skeleton.phase_budget.alpha_sec,
          theta: skeleton.phase_budget.theta_sec,
          gamma: skeleton.phase_budget.gamma_sec,
        },
        entrainment_plan: DEFAULT_ENTRAINMENT_PLAN,
        person_config: { induction: "second", theta_declarations: "first" },
        pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
        posture: "sitting",
        middle_start: 2,
        middle_count: 2,
      },
      skeleton,
    };

    const draft = {
      meta: { goal_version_id: input.goal_version_id },
      segments: [
        {
          phase: "beta",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.beta,
          pause_after_ms: 500,
          text: "You begin.",
        },
        {
          phase: "alpha",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.alpha,
          pause_after_ms: 500,
          text: "You soften the body.",
        },
        ...input.skeleton.theta_steps.map((t) => ({
          phase: "theta" as const,
          step: t.step,
          target_duration_sec: t.target_sec,
          pause_after_ms: 500,
          text: "I hold the scene.",
        })),
        {
          phase: "gamma",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.gamma,
          pause_after_ms: 500,
          text: "You rise.",
        },
      ],
    };

    const { manifest } = spliceCountedSequenceSegments(draft, input);
    const segments = (manifest as { segments: Array<{
      phase: "beta" | "alpha" | "theta" | "gamma";
      pause_after_ms: number;
      target_duration_sec: number;
    }> }).segments;

    // Simulate TTS: voiced ≈ 40% of target (cue/speech), silence from pause_after_ms.
    const forReconcile = segments.map((s) => ({
      phase: s.phase,
      pause_after_ms: s.pause_after_ms,
      actual_duration_sec: Math.max(0.5, s.target_duration_sec * 0.35),
    }));

    const reconciled = reconcilePhaseTiming({
      phaseBudgetSec: input.session.phase_budget_sec,
      segments: forReconcile,
    });

    for (const segment of reconciled.segments) {
      expect(segment.scheduled_pause_after_ms).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
    }

    const wallSec = reconciled.segments.reduce(
      (sum, s) => sum + s.actual_duration_sec + (s.scheduled_pause_after_ms ?? 0) / 1000,
      0,
    );
    const budgetSec = 15 * 60;
    // No multi-minute dead-air inflation: wall clock should not massively exceed budget.
    expect(wallSec).toBeLessThanOrEqual(budgetSec * 1.05);
    // And should not be dominated by absurd pauses (cap keeps us bounded).
    const maxPause = Math.max(...reconciled.segments.map((s) => s.scheduled_pause_after_ms ?? 0));
    expect(maxPause).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
  });
});
