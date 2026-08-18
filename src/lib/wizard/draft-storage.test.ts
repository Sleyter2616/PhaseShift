import { describe, expect, it } from "vitest";
import { EMPTY_WIZARD_DRAFT } from "@/lib/contracts/wizard";
import {
  parseStoredWizardDraft,
  wizardDraftHasContent,
  wizardDraftStorageKey,
} from "./draft-storage";

describe("wizard draft storage", () => {
  it("keys drafts per user", () => {
    expect(wizardDraftStorageKey("user-1")).toBe("phaseshift:wizard-draft:v1:user-1");
  });

  it("parses a valid stored payload", () => {
    const draft = {
      ...EMPTY_WIZARD_DRAFT,
      goal_statement: "I am shipping the product.",
    };
    const parsed = parseStoredWizardDraft({
      version: 1,
      step: 3,
      draft,
      reusedFromId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed?.step).toBe(3);
    expect(parsed?.draft.goal_statement).toBe("I am shipping the product.");
  });

  it("rejects invalid or empty payloads", () => {
    expect(parseStoredWizardDraft(null)).toBeNull();
    expect(parseStoredWizardDraft({ version: 2, step: 1, draft: {} })).toBeNull();
    expect(parseStoredWizardDraft({ version: 1, step: 99, draft: EMPTY_WIZARD_DRAFT })).toBeNull();
  });

  it("detects meaningful content vs empty defaults", () => {
    expect(wizardDraftHasContent(EMPTY_WIZARD_DRAFT)).toBe(false);
    expect(
      wizardDraftHasContent({
        ...EMPTY_WIZARD_DRAFT,
        goal_statement: "I am present.",
      }),
    ).toBe(true);
  });
});
