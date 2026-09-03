import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2_6 } from "./prompt.v2.6";
import { COMPILER_PROMPT_V2_7, PROMPT_VERSION } from "./prompt.v2.7";

describe("prompt.v2.7", () => {
  it("pins PROMPT_VERSION to v2.7", () => {
    expect(PROMPT_VERSION).toBe("v2.7");
  });

  it("keeps v2.6 immutable", () => {
    expect(COMPILER_PROMPT_V2_6).toContain("Phase Locking Script Compiler (v2.6)");
    expect(COMPILER_PROMPT_V2_6).toContain("OPENING PACE");
    expect(COMPILER_PROMPT_V2_6).toContain("progressive muscle tension-release (feet to face)");
  });

  it("requires a server-spliced per-part body scan with inter-cue silence", () => {
    expect(COMPILER_PROMPT_V2_7).toContain("Phase Locking Script Compiler (v2.7)");
    expect(COMPILER_PROMPT_V2_7).toContain("alpha_body_scan");
    expect(COMPILER_PROMPT_V2_7).toContain("one short cue per body part");
    expect(COMPILER_PROMPT_V2_7).toContain("3-5s of real silence");
    expect(COMPILER_PROMPT_V2_7).toContain("Do NOT write the progressive body scan");
    expect(COMPILER_PROMPT_V2_7).toContain("pack multiple body parts");
    expect(COMPILER_PROMPT_V2_7).not.toContain(
      "progressive muscle tension-release (feet to face), calming imagery",
    );
  });
});
