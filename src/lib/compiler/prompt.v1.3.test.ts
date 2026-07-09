import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V1_2 } from "./prompt.v1.2";
import { COMPILER_PROMPT_V1_3, PROMPT_VERSION } from "./prompt.v1.3";

describe("prompt.v1.3", () => {
  it("pins PROMPT_VERSION to v1.3", () => {
    expect(PROMPT_VERSION).toBe("v1.3");
  });

  it("retains v1.2 core text", () => {
    expect(COMPILER_PROMPT_V1_3).toContain(COMPILER_PROMPT_V1_2.slice(0, 200));
    expect(COMPILER_PROMPT_V1_3).toContain("Emit ONLY the JSON object");
    expect(COMPILER_PROMPT_V1_3).toContain("Do not count words");
  });

  it("adds negation-aware banned-token guidance in VOICE AND PERSON", () => {
    expect(COMPILER_PROMPT_V1_3).toContain("Banned tokens must not appear anywhere in theta text");
    expect(COMPILER_PROMPT_V1_3).toContain("including inside");
    expect(COMPILER_PROMPT_V1_3).toContain("'not someday'");
    expect(COMPILER_PROMPT_V1_3).toContain("Ninety days, on the calendar");
  });
});
