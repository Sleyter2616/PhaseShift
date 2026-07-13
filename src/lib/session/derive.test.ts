import { describe, expect, it } from "vitest";
import { PHASE_BUDGET_SEC } from "../costs";
import {
  buildCompilerInput,
  compilerInputForModel,
  deriveSessionFromIntake,
  DEFAULT_ENTRAINMENT_PLAN,
} from "./derive";
import { intake20Min, intake40Min } from "../fixtures/intake";
import type { Intake } from "../contracts/intake";

function intakeWithDuration(duration: 20 | 30 | 40 | 60): Intake {
  return {
    ...intake40Min,
    session: { ...intake40Min.session, duration_min: duration },
  };
}

describe("deriveSessionFromIntake", () => {
  it.each([
    [20, PHASE_BUDGET_SEC[20]],
    [30, PHASE_BUDGET_SEC[30]],
    [40, PHASE_BUDGET_SEC[40]],
    [60, PHASE_BUDGET_SEC[60]],
  ] as const)("maps %s-min preset to phase_budget_sec", (duration, expectedBudget) => {
    const session = deriveSessionFromIntake(intakeWithDuration(duration));
    expect(session.duration_min).toBe(duration);
    expect(session.phase_budget_sec).toEqual(expectedBudget);
    expect(session.entrainment_plan).toEqual(DEFAULT_ENTRAINMENT_PLAN);
    expect(session.pacing).toEqual({ beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 });
  });

  it("derives from the 20-min golden fixture", () => {
    const session = deriveSessionFromIntake(intake20Min);
    expect(session.duration_min).toBe(20);
    expect(session.phase_budget_sec.theta).toBe(780);
  });
});

describe("buildCompilerInput", () => {
  it("stores raw intake and normalized speech fields for the model", () => {
    const input = buildCompilerInput(intake40Min, "550e8400-e29b-41d4-a716-446655440000");
    expect(input.raw.goal_statement).toBe(intake40Min.goal_statement);
    expect(input.raw.localization.timeframe).toBe("90d");
    expect(input.raw.sync_actions[1]?.deadline).toBe("2026-07-14");
    expect(input.localization.timeframe).toBe("ninety days");
    expect(input.sync_actions[1]?.deadline).toBe("July fourteenth, twenty twenty-six");
    expect(compilerInputForModel(input)).not.toHaveProperty("raw");
  });

  it("normalizes currency and clock times inside intake strings", () => {
    const intake: Intake = {
      ...intake40Min,
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
});
