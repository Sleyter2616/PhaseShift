import { describe, expect, it } from "vitest";
import { buildSessionSkeleton } from "./skeleton";
import { injectServerOwnedFields } from "./inject-server-fields";
import type { CompilerInput } from "../session/derive";
import { DEFAULT_ENTRAINMENT_PLAN } from "../session/derive";

function compilerInputForLength(lengthMin: 15 | 45): CompilerInput {
  const middle_count = lengthMin === 15 ? 2 : 10;
  const skeleton = buildSessionSkeleton({
    length_min: lengthMin,
    middle_start: 2,
    middle_count,
  });
  const phase_budget_sec = {
    beta: skeleton.phase_budget.beta_sec,
    alpha: skeleton.phase_budget.alpha_sec,
    theta: skeleton.phase_budget.theta_sec,
    gamma: skeleton.phase_budget.gamma_sec,
  };
  return {
    goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
    raw: {
      goal_statement: "Test goal statement here.",
      localization: { timeframe: "90d", place: "Test place" },
      triangulation: ["prereq one here", "prereq two here", "prereq three here"],
      not_list: ["not one", "not two"],
      wrong_direction_pulls: [],
      features: ["email from manager", "badge at lobby", "paycheck on friday"],
      sync_actions: [{ action: "send the email" }],
    },
    goal_statement: "Test goal statement here.",
    localization: { timeframe: "ninety days", place: "Test place" },
    triangulation: ["prereq one here", "prereq two here", "prereq three here"],
    not_list: ["not one", "not two"],
    wrong_direction_pulls: [],
    features: ["email from manager", "badge at lobby", "paycheck on friday"],
    sync_actions: [{ action: "send the email" }],
    senses_emphasis: ["sight", "touch"],
    session: {
      duration_min: lengthMin,
      phase_budget_sec,
      entrainment_plan:
        phase_budget_sec.beta === 0
          ? DEFAULT_ENTRAINMENT_PLAN.filter((e) => e.phase !== "beta")
          : DEFAULT_ENTRAINMENT_PLAN,
      person_config: { induction: "second", theta_declarations: "first" },
      pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
      posture: "sitting",
      middle_start: 2,
      middle_count,
    },
    skeleton,
  };
}

describe("injectServerOwnedFields", () => {
  it("stamps meta totals, entrainment, seq, and pacing_wpm", () => {
    const input = compilerInputForLength(15);
    const draft = {
      meta: { goal_version_id: "00000000-0000-0000-0000-000000000099" },
      segments: [
        {
          phase: "beta",
          step: 3,
          target_duration_sec: 60,
          pause_after_ms: 0,
          text: "You settle in.",
        },
        {
          phase: "theta",
          step: 1,
          target_duration_sec: 100,
          pause_after_ms: 500,
          text: "I see the scene.",
        },
      ],
    };

    const { manifest, actions } = injectServerOwnedFields(draft, input);
    const stamped = manifest as {
      meta: {
        goal_version_id: string;
        total_duration_sec: number;
        phase_budget_sec: typeof input.session.phase_budget_sec;
        entrainment_plan: unknown[];
      };
      segments: Array<{
        seq: number;
        step: number | null;
        pacing_wpm: number;
        phase: string;
      }>;
    };

    expect(stamped.meta.goal_version_id).toBe(input.goal_version_id);
    expect(stamped.meta.total_duration_sec).toBe(15 * 60);
    expect(stamped.meta.phase_budget_sec).toEqual(input.session.phase_budget_sec);
    expect(stamped.meta.entrainment_plan).toEqual(input.session.entrainment_plan);
    expect(stamped.segments[0]).toMatchObject({
      seq: 1,
      phase: "beta",
      step: null,
      pacing_wpm: 130,
    });
    expect(stamped.segments[1]).toMatchObject({
      seq: 2,
      phase: "theta",
      step: 1,
      pacing_wpm: 105,
    });
    expect(actions.some((a) => a.includes("total_duration_sec"))).toBe(true);
  });
});
