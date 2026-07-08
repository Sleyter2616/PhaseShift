import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V1 } from "./prompt.v1";
import { COMPILER_PROMPT_V1_1, PROMPT_VERSION } from "./prompt.v1.1";

describe("prompt.v1.1", () => {
  it("pins PROMPT_VERSION to v1.1", () => {
    expect(PROMPT_VERSION).toBe("v1.1");
  });

  it("retains the v1 core prompt text", () => {
    expect(COMPILER_PROMPT_V1_1).toContain("Phase Locking Script Compiler");
    expect(COMPILER_PROMPT_V1_1).toContain("## STRUCTURAL RULES");
    expect(COMPILER_PROMPT_V1_1).toContain("## STEP SPECIFICATIONS (theta)");
    expect(COMPILER_PROMPT_V1_1).toContain(COMPILER_PROMPT_V1.slice(0, 200));
  });

  it("embeds the OUTPUT SCHEMA section before SELF-CHECK", () => {
    const schemaIdx = COMPILER_PROMPT_V1_1.indexOf("## OUTPUT SCHEMA (exact, mandatory)");
    const selfCheckIdx = COMPILER_PROMPT_V1_1.indexOf("## SELF-CHECK (run before emitting)");
    expect(schemaIdx).toBeGreaterThan(-1);
    expect(selfCheckIdx).toBeGreaterThan(schemaIdx);
    expect(COMPILER_PROMPT_V1_1).toContain('"phase_budget_sec": <copied verbatim from input session.phase_budget_sec>');
    expect(COMPILER_PROMPT_V1_1).toContain('"seq": <1-based integer, strictly increasing across the whole manifest>');
  });

  it("extends SELF-CHECK with schema field-name guard", () => {
    expect(COMPILER_PROMPT_V1_1).toContain(
      "7. Output contains only the schema fields above, with these exact names.",
    );
  });
});
