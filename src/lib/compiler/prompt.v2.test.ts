import { describe, expect, it } from "vitest";
import { buildSessionSkeleton } from "./skeleton";
import {
  COMPILER_PROMPT_V2,
  formatSkeletonForPrompt,
  PROMPT_VERSION,
} from "./prompt.v2";

describe("prompt.v2.0", () => {
  it("pins PROMPT_VERSION to v2.0", () => {
    expect(PROMPT_VERSION).toBe("v2.0");
  });

  it("declares skeleton as server-owned givens", () => {
    expect(COMPILER_PROMPT_V2).toContain("## SKELETON GIVENS (do not renegotiate)");
    expect(COMPILER_PROMPT_V2).toContain("SERVER-COMPUTED SESSION SKELETON");
    expect(COMPILER_PROMPT_V2).toContain("When beta_sec is 0, OMIT the beta phase");
    expect(COMPILER_PROMPT_V2).toContain("MUST use");
    expect(COMPILER_PROMPT_V2).toContain("skeleton.counted_sequences VERBATIM");
  });

  it("ports core content rules from v1.x", () => {
    expect(COMPILER_PROMPT_V2).toContain("present tense only");
    expect(COMPILER_PROMPT_V2).toContain("Banned: will, would, could, might, hope, wish");
    expect(COMPILER_PROMPT_V2).toContain("Banned tokens must not appear anywhere in theta text");
    expect(COMPILER_PROMPT_V2).toContain("appears verbatim at least once");
    expect(COMPILER_PROMPT_V2).toContain("at least 20% of their duration as");
    expect(COMPILER_PROMPT_V2).toContain("## CONTENT RULES (mandatory)");
    expect(COMPILER_PROMPT_V2).toContain('write "one million dollars", not "$1M"');
    expect(COMPILER_PROMPT_V2).toContain("At most one full countdown across alpha");
  });

  it("includes posture-driven language rules", () => {
    expect(COMPILER_PROMPT_V2).toContain("## POSTURE (from skeleton.posture)");
    expect(COMPILER_PROMPT_V2).toContain("sitting (default)");
    expect(COMPILER_PROMPT_V2).toContain("lying:");
  });

  it("formatSkeletonForPrompt exposes budgets, steps, and timings", () => {
    const skeleton = buildSessionSkeleton({ length_min: 15, middle_start: 4, middle_count: 2 });
    const formatted = formatSkeletonForPrompt(skeleton);
    expect(formatted.length_min).toBe(15);
    expect(formatted.posture).toBe("sitting");
    expect(formatted.phase_budget).toMatchObject({
      beta_sec: skeleton.phase_budget.beta_sec,
      theta_sec: skeleton.phase_budget.theta_sec,
    });
    expect(formatted.theta_steps).toEqual(skeleton.theta_steps);
    const sequences = formatted.counted_sequences as Record<string, string>;
    expect(sequences.alpha_breath).toContain("breath");
    expect(sequences.alpha_countdown).toContain("countdown");
  });
});
