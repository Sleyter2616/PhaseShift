import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V1_3 } from "./prompt.v1.3";
import { COMPILER_PROMPT_V1_4, PROMPT_VERSION } from "./prompt.v1.4";

describe("prompt.v1.4", () => {
  it("pins PROMPT_VERSION to v1.4", () => {
    expect(PROMPT_VERSION).toBe("v1.4");
  });

  it("retains v1.3 core text", () => {
    expect(COMPILER_PROMPT_V1_4).toContain(COMPILER_PROMPT_V1_3.slice(0, 200));
    expect(COMPILER_PROMPT_V1_4).toContain("Banned tokens must not appear anywhere in theta text");
  });

  it("adds founder content rules", () => {
    expect(COMPILER_PROMPT_V1_4).toContain("## CONTENT RULES (mandatory)");
    expect(COMPILER_PROMPT_V1_4).toContain("Write all numbers as words");
    expect(COMPILER_PROMPT_V1_4).toContain("Introduce every countdown before it begins");
    expect(COMPILER_PROMPT_V1_4).toContain("one explicit transition sentence naming the shift");
    expect(COMPILER_PROMPT_V1_4).toContain("Never read dates as digit sequences");
    expect(COMPILER_PROMPT_V1_4).toContain(
      "All numerals, currency, and dates in output must be written as spoken words",
    );
  });
});
