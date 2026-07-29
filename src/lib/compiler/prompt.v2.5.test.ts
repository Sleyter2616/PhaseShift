import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2_4 } from "./prompt.v2.4";
import { COMPILER_PROMPT_V2_5, PROMPT_VERSION } from "./prompt.v2.5";

describe("prompt.v2.5", () => {
  it("pins PROMPT_VERSION to v2.5", () => {
    expect(PROMPT_VERSION).toBe("v2.5");
  });

  it("keeps v2.4 immutable", () => {
    expect(COMPILER_PROMPT_V2_4).toContain("Phase Locking Script Compiler (v2.4)");
    expect(COMPILER_PROMPT_V2_4).toContain("HARD MINIMUM");
  });

  it("clarifies person-aware verbatim for second-person embedding", () => {
    expect(COMPILER_PROMPT_V2_5).toContain("PERSON-AWARE VERBATIM");
    expect(COMPILER_PROMPT_V2_5).toContain("my→your");
    expect(COMPILER_PROMPT_V2_5).toContain("your Hamilton Heights apartment");
    expect(COMPILER_PROMPT_V2_5).toContain('the role is mine" stays "mine"');
    expect(COMPILER_PROMPT_V2_5).not.toContain(
      "appears verbatim at least once, in its designated step",
    );
  });
});
