import { describe, expect, it } from "vitest";
import { rewriteGoalPresentTense } from "./intake";
import {
  DEFAULT_WIZARD_LENGTH_MIN,
  EMPTY_WIZARD_DRAFT,
  draftToIntake,
  validateWizardStep,
  withSessionLength,
  type WizardDraft,
} from "./wizard";
import { intake45Min } from "../fixtures/intake";
import { selectableMiddleCount } from "../compiler/skeleton";

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
      goal_statement: intake45Min.goal_statement,
      localization: intake45Min.localization,
      triangulation: intake45Min.triangulation,
      not_list: intake45Min.not_list,
      wrong_pulls: intake45Min.wrong_pulls,
      features: intake45Min.features,
      sync_actions: intake45Min.sync_actions,
      session: {
        ...withSessionLength(EMPTY_WIZARD_DRAFT.session, 45),
        entrainment_mode: intake45Min.session.entrainment_mode,
        senses_emphasis: intake45Min.session.senses_emphasis,
      },
    };
  }

  it("defaults empty draft to 30-min full arc", () => {
    expect(DEFAULT_WIZARD_LENGTH_MIN).toBe(30);
    expect(EMPTY_WIZARD_DRAFT.session.duration_min).toBe(30);
    expect(EMPTY_WIZARD_DRAFT.session.middle_count).toBe(10);
  });

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

  it("draftToIntake matches golden 45-min fixture", () => {
    const draft = fullDraft();
    expect(draftToIntake(draft)).toEqual(intake45Min);
  });

  it("draftToIntake derives middle_count from selected length", () => {
    const draft = {
      ...fullDraft(),
      session: withSessionLength(fullDraft().session, 15),
    };
    const intake = draftToIntake(draft);
    expect(intake.session.duration_min).toBe(15);
    expect(intake.session.middle_count).toBe(selectableMiddleCount(15));
    expect(intake.session.middle_start).toBe(2);
  });
});
