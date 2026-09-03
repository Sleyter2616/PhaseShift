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
    expect(COMPILER_PROMPT_V2).toContain("SERVER-INSERTED as micro-segments");
    expect(COMPILER_PROMPT_V2).toContain("Do NOT embed <break> tags for counted sequences");
  });

  it("forbids worded break tags and counted-sequence narration", () => {
    expect(COMPILER_PROMPT_V2).toContain("NUMERIC seconds only");
    expect(COMPILER_PROMPT_V2).toContain('never "one.5s"');
    expect(COMPILER_PROMPT_V2).toContain("Do NOT narrate timing ratios");
  });

  it("defines OUTPUT SHAPE for model-owned fields only", () => {
    expect(COMPILER_PROMPT_V2).toContain("## OUTPUT SHAPE (model-owned fields only)");
    expect(COMPILER_PROMPT_V2).toContain("do NOT emit those server-owned fields");
    expect(COMPILER_PROMPT_V2).toContain('"pause_after_ms"');
    expect(COMPILER_PROMPT_V2).toContain('"text"');
    expect(COMPILER_PROMPT_V2).not.toContain(
      '"total_duration_sec": <sum of all phase_budget_sec values>',
    );
  });

  it("ports core content rules from v1.x", () => {
    expect(COMPILER_PROMPT_V2).toContain("present tense only");
    expect(COMPILER_PROMPT_V2).toContain("Banned: will, would, could, might, hope, wish");
    expect(COMPILER_PROMPT_V2).toContain("Banned tokens must not appear anywhere in theta text");
    expect(COMPILER_PROMPT_V2).toContain("appears verbatim at least once");
    expect(COMPILER_PROMPT_V2).toContain("at least 20% of their duration as");
    expect(COMPILER_PROMPT_V2).toContain("## CONTENT RULES (mandatory)");
    expect(COMPILER_PROMPT_V2).toContain('write "one million dollars", not "$1M"');
    expect(COMPILER_PROMPT_V2).toContain("progressive muscle tension-release");
  });

  it("includes posture-driven language rules", () => {
    expect(COMPILER_PROMPT_V2).toContain("## POSTURE (from skeleton.posture)");
    expect(COMPILER_PROMPT_V2).toContain("sitting (default)");
    expect(COMPILER_PROMPT_V2).toContain("lying:");
  });

  it("formatSkeletonForPrompt exposes budgets, steps, depth, and word targets", () => {
    const skeleton = buildSessionSkeleton({ length_min: 15, middle_start: 4, middle_count: 2 });
    const formatted = formatSkeletonForPrompt(skeleton);
    expect(formatted.length_min).toBe(15);
    expect(formatted.posture).toBe("sitting");
    expect(formatted.phase_budget).toMatchObject({
      beta_sec: skeleton.phase_budget.beta_sec,
      theta_sec: skeleton.phase_budget.theta_sec,
    });
    expect(formatted.depth).toEqual(skeleton.depth);
    const thetaSteps = formatted.theta_steps as Array<{
      step: number;
      target_sec: number;
      target_words: number;
    }>;
    expect(thetaSteps).toHaveLength(skeleton.theta_steps.length);
    expect(thetaSteps[0]?.target_sec).toBe(skeleton.theta_steps[0]?.target_sec);
    expect(thetaSteps[0]?.target_words).toBe(skeleton.theta_steps[0]?.target_words);
    const sequences = formatted.counted_sequences as Record<string, string>;
    expect(sequences).not.toHaveProperty("alpha_breath");
    expect(sequences.alpha_body_scan).toContain("body_scan");
    expect(sequences.alpha_countdown).toContain("countdown");
  });
});
