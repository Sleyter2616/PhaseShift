import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2_2 } from "./prompt.v2.2";
import { COMPILER_PROMPT_V2_3, PROMPT_VERSION } from "./prompt.v2.3";

describe("prompt.v2.3", () => {
  it("pins PROMPT_VERSION to v2.3", () => {
    expect(PROMPT_VERSION).toBe("v2.3");
  });

  it("keeps v2.2 immutable", () => {
    expect(COMPILER_PROMPT_V2_2).toContain("Phase Locking Script Compiler (v2.2)");
    expect(COMPILER_PROMPT_V2_2).toContain("write ZERO references to breathing");
    expect(COMPILER_PROMPT_V2_2).toContain("alpha_breath");
  });

  it("instructs self-paced 4/2/8 breath and bans live cueing", () => {
    expect(COMPILER_PROMPT_V2_3).toContain("self-paced breath pattern ONCE");
    expect(COMPILER_PROMPT_V2_3).toContain("in for about four");
    expect(COMPILER_PROMPT_V2_3).toContain("exhale for eight");
    expect(COMPILER_PROMPT_V2_3).toContain("NEVER live-cue breath");
    expect(COMPILER_PROMPT_V2_3).toContain("breathe in now");
    expect(COMPILER_PROMPT_V2_3).not.toContain("alpha_breath");
    expect(COMPILER_PROMPT_V2_3).toContain("alpha_countdown");
    expect(COMPILER_PROMPT_V2_3).toContain("OCCASIONAL gentle cadence reminders");
  });
});
