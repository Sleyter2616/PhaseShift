import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2_5 } from "./prompt.v2.5";
import { COMPILER_PROMPT_V2_6, PROMPT_VERSION } from "./prompt.v2.6";

describe("prompt.v2.6", () => {
  it("pins PROMPT_VERSION to v2.6", () => {
    expect(PROMPT_VERSION).toBe("v2.6");
  });

  it("keeps v2.5 immutable", () => {
    expect(COMPILER_PROMPT_V2_5).toContain("Phase Locking Script Compiler (v2.5)");
    expect(COMPILER_PROMPT_V2_5).toContain("PERSON-AWARE VERBATIM");
  });

  it("requires unhurried opening before the body scan", () => {
    expect(COMPILER_PROMPT_V2_6).toContain("OPENING PACE");
    expect(COMPILER_PROMPT_V2_6).toContain("unhurried");
    expect(COMPILER_PROMPT_V2_6).toContain("progressive body scan");
    expect(COMPILER_PROMPT_V2_6).toContain("Phase Locking Script Compiler (v2.6)");
  });
});
