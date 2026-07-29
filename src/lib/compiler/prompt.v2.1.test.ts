import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V2 } from "./prompt.v2";
import { COMPILER_PROMPT_V2_1, PROMPT_VERSION } from "./prompt.v2.1";

describe("prompt.v2.1", () => {
  it("pins PROMPT_VERSION to v2.1", () => {
    expect(PROMPT_VERSION).toBe("v2.1");
  });

  it("keeps v2.0 immutable and available", () => {
    expect(COMPILER_PROMPT_V2).toContain("Phase Locking Script Compiler (v2.0)");
    expect(COMPILER_PROMPT_V2).toContain("include one explicit transition sentence naming the shift");
  });

  it("forbids phase-name transition sentences", () => {
    expect(COMPILER_PROMPT_V2_1).not.toContain(
      "include one explicit transition sentence naming the shift",
    );
    expect(COMPILER_PROMPT_V2_1).toContain("Phase transitions are SEAMLESS");
    expect(COMPILER_PROMPT_V2_1).toContain("Never name phases or announce machinery");
    expect(COMPILER_PROMPT_V2_1).toContain("No phase-name announcements");
  });

  it("bans model breath/rhythm/cadence language and removes orienting-beat leeway", () => {
    expect(COMPILER_PROMPT_V2_1).toContain("write ZERO references to breathing");
    expect(COMPILER_PROMPT_V2_1).toContain("are the ENTIRE breath experience");
    expect(COMPILER_PROMPT_V2_1).not.toContain("fold a brief orienting beat into the opening of alpha");
    expect(COMPILER_PROMPT_V2_1).toContain("begin alpha directly with tension-release");
  });
});
