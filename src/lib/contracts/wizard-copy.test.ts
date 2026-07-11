import { describe, expect, it } from "vitest";
import { WIZARD_STEP_COPY } from "./wizard-copy";

describe("WIZARD_STEP_COPY", () => {
  it("defines explainers for all seven wizard steps", () => {
    for (let step = 1; step <= 7; step += 1) {
      const copy = WIZARD_STEP_COPY[step];
      expect(copy?.heading).toBeTruthy();
      expect(copy?.description.length).toBeGreaterThan(40);
    }
  });

  it("includes user-specified not_list and wrong_pulls copy", () => {
    expect(WIZARD_STEP_COPY[4]?.fields?.not_list?.description).toMatch(/near-miss/i);
    expect(WIZARD_STEP_COPY[4]?.fields?.wrong_pulls?.description).toMatch(/detour/i);
  });

  it("includes placeholders on text inputs", () => {
    expect(WIZARD_STEP_COPY[1]?.fields?.goal_statement?.placeholder).toBeTruthy();
    expect(WIZARD_STEP_COPY[2]?.fields?.place?.placeholder).toBeTruthy();
    expect(WIZARD_STEP_COPY[6]?.fields?.action?.placeholder).toBeTruthy();
  });
});
