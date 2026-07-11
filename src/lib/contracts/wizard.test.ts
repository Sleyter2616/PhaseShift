import { describe, expect, it } from "vitest";
import { rewriteGoalPresentTense } from "./intake";
import {
  EMPTY_WIZARD_DRAFT,
  draftToIntake,
  validateWizardStep,
  type WizardDraft,
} from "./wizard";
import { intake40Min } from "../fixtures/intake";

describe("rewriteGoalPresentTense", () => {
  it("strips I want and capitalizes the remainder", () => {
    expect(rewriteGoalPresentTense("I want the senior role at Meridian Labs.")).toBe(
      "The senior role at Meridian Labs.",
    );
  });

  it("strips I will with leading whitespace", () => {
    expect(rewriteGoalPresentTense("  I will receive the offer this week")).toBe(
      "Receive the offer this week",
    );
  });

  it("returns input unchanged when pattern does not match", () => {
    expect(rewriteGoalPresentTense("The role is mine now.")).toBe("The role is mine now.");
  });
});

describe("validateWizardStep", () => {
  function fullDraft(): WizardDraft {
    return {
      ...EMPTY_WIZARD_DRAFT,
      goal_statement: intake40Min.goal_statement,
      localization: intake40Min.localization,
      triangulation: intake40Min.triangulation,
      not_list: intake40Min.not_list,
      wrong_pulls: intake40Min.wrong_pulls,
      features: intake40Min.features,
      sync_actions: intake40Min.sync_actions,
      session: {
        duration_min: 40,
        entrainment_mode: intake40Min.session.entrainment_mode,
        senses_emphasis: intake40Min.session.senses_emphasis,
      },
    };
  }

  it("passes all steps for a valid golden draft", () => {
    const draft = fullDraft();
    for (let step = 1; step <= 7; step += 1) {
      expect(validateWizardStep(step, draft)).toBeNull();
    }
  });

  it("rejects step 1 when goal uses present-tense lint", () => {
    const draft = { ...fullDraft(), goal_statement: "I want the job." };
    expect(validateWizardStep(1, draft)).toMatch(/present-tense/i);
  });

  it("draftToIntake matches golden 40-min fixture", () => {
    const draft = fullDraft();
    expect(draftToIntake(draft)).toEqual(intake40Min);
  });
});
