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

  it("adds speakable-output and alpha deepening rules", () => {
    expect(COMPILER_PROMPT_V1_4).toContain("## CONTENT RULES (mandatory)");
    expect(COMPILER_PROMPT_V1_4).toContain(
      'write "one million dollars", not "$1M"',
    );
    expect(COMPILER_PROMPT_V1_4).toContain("Counting down from ten now");
    expect(COMPILER_PROMPT_V1_4).toContain("## ALPHA guidance (mandatory)");
    expect(COMPILER_PROMPT_V1_4).toContain("At most one full countdown across alpha");
    expect(COMPILER_PROMPT_V1_4).toContain("breath and body cues only");
  });
});
