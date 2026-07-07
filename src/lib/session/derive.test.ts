import { describe, expect, it } from "vitest";
import { PHASE_BUDGET_SEC } from "../costs";
import { deriveSessionFromIntake, DEFAULT_ENTRAINMENT_PLAN } from "./derive";
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
