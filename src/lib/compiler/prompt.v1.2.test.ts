import { describe, expect, it } from "vitest";
import { COMPILER_PROMPT_V1_1 } from "./prompt.v1.1";
import { COMPILER_PROMPT_V1_2, PROMPT_VERSION } from "./prompt.v1.2";

describe("prompt.v1.2", () => {
  it("pins PROMPT_VERSION to v1.2", () => {
    expect(PROMPT_VERSION).toBe("v1.2");
  });

  it("retains v1.1 core text", () => {
    expect(COMPILER_PROMPT_V1_2).toContain(COMPILER_PROMPT_V1_1.slice(0, 200));
    expect(COMPILER_PROMPT_V1_2).toContain("## OUTPUT SCHEMA (exact, mandatory)");
  });

  it("adds downstream-tolerance and JSON-only guidance", () => {
    expect(COMPILER_PROMPT_V1_2).toContain("Emit ONLY the JSON object");
    expect(COMPILER_PROMPT_V1_2).toContain("Do not count words");
    expect(COMPILER_PROMPT_V1_2).toContain('chain multiple <break time=\\"3.0s\\"/> tags');
  });
});
