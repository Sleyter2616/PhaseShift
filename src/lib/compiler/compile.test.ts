import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildSessionSkeleton } from "./skeleton";
import { CompilerError, compileManifest, formatCompilerFailureMessage, PROMPT_VERSION } from "./compile";
import { COMPILER_PROMPT_V2 } from "./prompt.v2";
import type { CompilerInput } from "../session/derive";

const skeleton = buildSessionSkeleton({ length_min: 15 });

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
    duration_min: 15,
    phase_budget_sec: {
      beta: skeleton.phase_budget.beta_sec,
      alpha: skeleton.phase_budget.alpha_sec,
      theta: skeleton.phase_budget.theta_sec,
      gamma: skeleton.phase_budget.gamma_sec,
    },
    entrainment_plan: [
      { phase: "beta", hz: 18, glide_to: 10, glide_sec: 45 },
      { phase: "alpha", hz: 10, glide_to: 6, glide_sec: 60 },
      { phase: "theta", hz: 6, glide_to: null },
      { phase: "gamma", hz: 40, glide_sec: 30 },
    ],
    person_config: { induction: "second", theta_declarations: "first" },
    pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
    posture: "sitting",
    middle_start: 2,
    middle_count: 2,
  },
  skeleton,
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

  it("defaults to prompt v2.0", () => {
    expect(PROMPT_VERSION).toBe("v2.0");
  });

  it("sends the v2 system prompt and skeleton in the user message", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "{not json" }],
    });
    await expect(
      compileManifest(FIXTURE_INPUT, { client: { messages: { create } } as never }),
    ).rejects.toBeInstanceOf(CompilerError);

    expect(create).toHaveBeenCalled();
    const firstCall = create.mock.calls[0]![0] as {
      system: string;
      messages: [{ content: string }];
    };
    expect(firstCall.system).toBe(COMPILER_PROMPT_V2);
    const user = JSON.parse(firstCall.messages[0]!.content) as {
      skeleton: { length_min: number; steps: unknown[] };
    };
    expect(user.skeleton.length_min).toBe(15);
    expect(user.skeleton.steps).toHaveLength(4);
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
