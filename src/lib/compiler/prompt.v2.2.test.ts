import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2_1 } from "./prompt.v2.1";
import { COMPILER_PROMPT_V2_2, PROMPT_VERSION } from "./prompt.v2.2";

describe("prompt.v2.2", () => {
  it("pins PROMPT_VERSION to v2.2", () => {
    expect(PROMPT_VERSION).toBe("v2.2");
  });

  it("keeps v2.1 immutable", () => {
    expect(COMPILER_PROMPT_V2_1).toContain("Phase Locking Script Compiler (v2.1)");
    expect(COMPILER_PROMPT_V2_1).not.toContain("## DEPTH BY LENGTH");
  });

  it("adds depth-by-length guidance and per-step word targets", () => {
    expect(COMPILER_PROMPT_V2_2).toContain("## DEPTH BY LENGTH (skeleton.depth)");
    expect(COMPILER_PROMPT_V2_2).toContain("density_factor > 1");
    expect(COMPILER_PROMPT_V2_2).toContain("greater SENSORY density");
    expect(COMPILER_PROMPT_V2_2).toContain("Do not add steps");
    expect(COMPILER_PROMPT_V2_2).toContain("target_words");
    expect(COMPILER_PROMPT_V2_2).toContain("ACTION INTEGRATION");
  });
});
