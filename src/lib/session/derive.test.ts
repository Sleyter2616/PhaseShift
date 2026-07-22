import { describe, expect, it } from "vitest";
import { PHASE_BUDGET_SEC } from "../costs";
import { buildSessionSkeleton } from "../compiler/skeleton";
import {
  buildCompilerInput,
  compilerInputForModel,
  deriveSessionFromIntake,
  skeletonFromIntake,
} from "./derive";
import { intake15Min, intake45Min } from "../fixtures/intake";
import type { Intake } from "../contracts/intake";

function intakeWithDuration(duration: 10 | 15 | 30 | 45): Intake {
  const middle_count = { 10: 1, 15: 2, 30: 6, 45: 10 }[duration];
  return {
    ...intake45Min,
    session: {
      ...intake45Min.session,
      duration_min: duration,
      middle_start: 2,
      middle_count,
    },
  };
}

describe("deriveSessionFromIntake", () => {
  it.each([10, 15, 30, 45] as const)("maps %s-min preset to skeleton phase_budget_sec", (duration) => {
    const session = deriveSessionFromIntake(intakeWithDuration(duration));
    expect(session.duration_min).toBe(duration);
    expect(session.phase_budget_sec).toEqual(PHASE_BUDGET_SEC[duration]);
    expect(session.pacing).toEqual({ beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 });
    const total =
      session.phase_budget_sec.beta +
      session.phase_budget_sec.alpha +
      session.phase_budget_sec.theta +
      session.phase_budget_sec.gamma;
    expect(total).toBe(duration * 60);
  });

  it("sets beta=0 and omits beta entrainment at 10 min", () => {
    const session = deriveSessionFromIntake(intakeWithDuration(10));
    expect(session.phase_budget_sec.beta).toBe(0);
    expect(session.entrainment_plan.every((e) => e.phase !== "beta")).toBe(true);
  });

  it("derives from the 15-min golden fixture", () => {
    const session = deriveSessionFromIntake(intake15Min);
    expect(session.duration_min).toBe(15);
    expect(session.middle_count).toBe(2);
    expect(session.phase_budget_sec).toEqual(PHASE_BUDGET_SEC[15]);
  });
});

describe("buildCompilerInput", () => {
  it("stores raw intake, skeleton, and normalized speech fields for the model", () => {
    const input = buildCompilerInput(intake45Min, "550e8400-e29b-41d4-a716-446655440000");
    expect(input.raw.goal_statement).toBe(intake45Min.goal_statement);
    expect(input.raw.localization.timeframe).toBe("90d");
    expect(input.raw.sync_actions[1]?.deadline).toBe("2026-07-14");
    expect(input.localization.timeframe).toBe("ninety days");
    expect(input.sync_actions[1]?.deadline).toBe("July fourteenth, twenty twenty-six");
    expect(input.skeleton.steps).toEqual(buildSessionSkeleton({ length_min: 45 }).steps);
    const forModel = compilerInputForModel(input);
    expect(forModel).not.toHaveProperty("raw");
    expect(forModel.skeleton).toHaveProperty("phase_budget");
    expect(forModel.skeleton).toHaveProperty("counted_sequences");
  });

  it("normalizes currency and clock times inside intake strings", () => {
    const intake: Intake = {
      ...intake45Min,
      goal_statement: "The $1M role is mine after the 9 AM offer call.",
      features: [
        "paycheck shows $83,333 base on the 15th",
        "badge scan logs 24/7 lobby entry",
        "email titled Senior Engineer arrives Monday",
      ],
    };
    const input = buildCompilerInput(intake, "550e8400-e29b-41d4-a716-446655440000");
    expect(input.goal_statement).toBe(
      "The one million dollars role is mine after the nine A M offer call.",
    );
    expect(input.features[0]).toBe(
      "paycheck shows eighty-three thousand three hundred thirty-three dollars base on the 15th",
    );
    expect(input.features[1]).toBe("badge scan logs 24/7 lobby entry");
  });

  it("skeletonFromIntake respects middle selection", () => {
    const skeleton = skeletonFromIntake(
      intakeWithDuration(15),
    );
    expect(skeleton.steps).toEqual([1, 2, 3, 12]);
  });
});
