import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CompilerError, compileManifest, formatCompilerFailureMessage } from "./compile";
import type { CompilerInput } from "../session/derive";

const FIXTURE_INPUT: CompilerInput = {
  goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
  raw: {
    goal_statement: "Test goal statement here.",
    localization: { timeframe: "90d", place: "Test place" },
    triangulation: ["prereq one here", "prereq two here", "prereq three here"],
    not_list: ["not one", "not two"],
    wrong_direction_pulls: [],
    features: ["email from manager", "badge at lobby", "paycheck on friday"],
    sync_actions: [{ action: "send the email" }],
  },
  goal_statement: "Test goal statement here.",
  localization: { timeframe: "90d", place: "Test place" },
  triangulation: ["prereq one here", "prereq two here", "prereq three here"],
  not_list: ["not one", "not two"],
  wrong_direction_pulls: [],
  features: ["email from manager", "badge at lobby", "paycheck on friday"],
  sync_actions: [{ action: "send the email" }],
  senses_emphasis: ["sight", "touch"],
  session: {
    duration_min: 20,
    phase_budget_sec: { beta: 60, alpha: 240, theta: 780, gamma: 120 },
    entrainment_plan: [
      { phase: "beta", hz: 18, glide_to: 10, glide_sec: 45 },
      { phase: "alpha", hz: 10, glide_to: 6, glide_sec: 60 },
      { phase: "theta", hz: 6, glide_to: null },
      { phase: "gamma", hz: 40, glide_sec: 30 },
    ],
    person_config: { induction: "second", theta_declarations: "first" },
    pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
  },
};

describe("compileManifest", () => {
  const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    stderrSpy.mockClear();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("populates rawResponse on final CompilerError", async () => {
    const raw = "```json\n{ definitely not valid }\n```";
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: "end_turn",
          usage: { input_tokens: 42, output_tokens: 99 },
          content: [{ type: "text", text: raw }],
        }),
      },
    };

    await expect(
      compileManifest(FIXTURE_INPUT, { client: mockClient as never }),
    ).rejects.toMatchObject({
      name: "CompilerError",
      rawResponse: raw,
      validationErrors: ["response was not valid JSON"],
    });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("compile attempt=2 stop_reason=end_turn in=42 out=99"),
    );
  });

  it("formatCompilerFailureMessage joins validation errors with pipe", () => {
    const error = new CompilerError(
      "manifest validation failed after retry",
      ["phase beta: mismatch", "segment seq 1: too long"],
      "raw body",
    );
    expect(formatCompilerFailureMessage(error)).toBe(
      "manifest validation failed after retry: phase beta: mismatch | segment seq 1: too long",
    );
  });
});
