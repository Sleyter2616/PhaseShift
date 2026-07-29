import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2_3 } from "./prompt.v2.3";
import { COMPILER_PROMPT_V2_4, PROMPT_VERSION } from "./prompt.v2.4";

describe("prompt.v2.4", () => {
  it("pins PROMPT_VERSION to v2.4", () => {
    expect(PROMPT_VERSION).toBe("v2.4");
  });

  it("keeps v2.3 immutable", () => {
    expect(COMPILER_PROMPT_V2_3).toContain("Phase Locking Script Compiler (v2.3)");
    expect(COMPILER_PROMPT_V2_3).toContain("self-paced breath pattern ONCE");
  });

  it("states theta target_words as hard minimums", () => {
    expect(COMPILER_PROMPT_V2_4).toContain("HARD MINIMUM");
    expect(COMPILER_PROMPT_V2_4).toContain("at least skeleton.theta_steps[].target_words");
    expect(COMPILER_PROMPT_V2_4).toContain("Sessions that fall short fail");
    expect(COMPILER_PROMPT_V2_4).toContain("Never treat ~85-90% as \"good enough.\"");
    expect(COMPILER_PROMPT_V2_4).toContain("MUST be ≥ that step's target_words");
  });
});
