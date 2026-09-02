import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildSessionSkeleton } from "./skeleton";
import {
  CompilerError,
  compileManifest,
  formatCompilerFailureMessage,
  PROMPT_VERSION,
} from "./compile";
import { COMPILER_PROMPT_V2_6 } from "./prompt.v2.6";
import type { CompilerInput } from "../session/derive";
import { DEFAULT_ENTRAINMENT_PLAN } from "../session/derive";

function padWords(minWords: number): string {
  const unit = "I hold the scene with steady focus and clear sensory detail";
  const words = unit.split(/\s+/);
  const out: string[] = [];
  while (out.length < minWords) out.push(...words);
  return out.slice(0, Math.max(minWords, 1)).join(" ");
}

function buildCompilerInput(lengthMin: 15 | 45): CompilerInput {
  const middle_count = lengthMin === 15 ? 2 : 10;
  const skeleton = buildSessionSkeleton({
    length_min: lengthMin,
    middle_start: 2,
    middle_count,
  });
  const phase_budget_sec = {
    beta: skeleton.phase_budget.beta_sec,
    alpha: skeleton.phase_budget.alpha_sec,
    theta: skeleton.phase_budget.theta_sec,
    gamma: skeleton.phase_budget.gamma_sec,
  };
  return {
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
    localization: { timeframe: "ninety days", place: "Test place" },
    triangulation: ["prereq one here", "prereq two here", "prereq three here"],
    not_list: ["not one", "not two"],
    wrong_direction_pulls: [],
    features: ["email from manager", "badge at lobby", "paycheck on friday"],
    sync_actions: [{ action: "send the email" }],
    senses_emphasis: ["sight", "touch"],
    session: {
      duration_min: lengthMin,
      phase_budget_sec,
      entrainment_plan:
        phase_budget_sec.beta === 0
          ? DEFAULT_ENTRAINMENT_PLAN.filter((e) => e.phase !== "beta")
          : [...DEFAULT_ENTRAINMENT_PLAN],
      person_config: { induction: "second", theta_declarations: "first" },
      pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
      posture: "sitting",
      middle_start: 2,
      middle_count,
    },
    skeleton,
  };
}

/**
 * Model-shaped draft: intentionally omits server-owned fields
 * (total_duration_sec, entrainment_plan, seq, pacing_wpm).
 */
function modelOwnedManifestDraft(
  input: CompilerInput,
  options?: { sparseTheta?: boolean },
): Record<string, unknown> {
  const budget = input.session.phase_budget_sec;
  const steps = input.skeleton.steps;
  const thetaTargets = input.skeleton.theta_steps;
  const pacing = input.session.pacing;

  const segments: Array<Record<string, unknown>> = [];

  if (budget.beta > 0) {
    const betaWords = Math.ceil((pacing.beta_wpm * budget.beta) / 60);
    segments.push({
      phase: "beta",
      step: null,
      title: "Orientation",
      perspective: "second",
      temporal_horizon: null,
      archetype: null,
      target_duration_sec: budget.beta,
      pause_after_ms: 1000,
      text: padWords(betaWords),
    });
  }

  const alphaRemain = Math.max(30, Math.floor(budget.alpha * 0.75));
  const alphaWords = Math.ceil((pacing.alpha_wpm * alphaRemain) / 60);
  segments.push({
    phase: "alpha",
    step: null,
    title: "Induction",
    perspective: "second",
    temporal_horizon: null,
    archetype: null,
    target_duration_sec: budget.alpha,
    pause_after_ms: 1000,
    text: padWords(alphaWords),
  });

  for (const timing of thetaTargets) {
    segments.push({
      phase: "theta",
      step: timing.step,
      title: `Step ${timing.step}`,
      perspective: "first",
      temporal_horizon: "protospective",
      archetype: null,
      target_duration_sec: timing.target_sec,
      pause_after_ms: 500,
      text: options?.sparseTheta
        ? "I hold a thin scene."
        : padWords(timing.target_words),
    });
  }

  const gammaWords = Math.ceil((pacing.gamma_wpm * budget.gamma) / 60);
  segments.push({
    phase: "gamma",
    step: null,
    title: "Exit",
    perspective: "second",
    temporal_horizon: null,
    archetype: null,
    target_duration_sec: budget.gamma,
    pause_after_ms: 500,
    text: padWords(Math.max(20, gammaWords)),
  });

  void steps;
  return {
    meta: {
      goal_version_id: input.goal_version_id,
    },
    segments,
  };
}

const FIXTURE_INPUT = buildCompilerInput(15);

describe("compileManifest", () => {
  const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    stderrSpy.mockClear();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to prompt v2.6", () => {
    expect(PROMPT_VERSION).toBe("v2.6");
  });

  it("sends the v2.6 system prompt and skeleton in the user message", async () => {
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
    expect(firstCall.system).toBe(COMPILER_PROMPT_V2_6);
    const user = JSON.parse(firstCall.messages[0]!.content) as {
      skeleton: {
        length_min: number;
        steps: unknown[];
        depth: { density_factor: number };
        theta_steps: Array<{ target_words: number }>;
        counted_sequences: Record<string, string>;
      };
    };
    expect(user.skeleton.length_min).toBe(15);
    expect(user.skeleton.steps).toHaveLength(4);
    expect(user.skeleton.depth.density_factor).toBe(1);
    expect(user.skeleton.theta_steps[0]?.target_words).toBeGreaterThan(0);
    expect(user.skeleton.counted_sequences).not.toHaveProperty("alpha_breath");
    expect(user.skeleton.counted_sequences).toHaveProperty("alpha_countdown");
  });

  it.each([15, 45] as const)(
    "accepts model-owned draft for %s-min session after server injection",
    async (lengthMin) => {
      const input = buildCompilerInput(lengthMin);
      const draft = modelOwnedManifestDraft(input);
      expect(draft.meta).not.toHaveProperty("total_duration_sec");
      expect(draft.meta).not.toHaveProperty("entrainment_plan");
      expect((draft.segments as object[])[0]).not.toHaveProperty("seq");
      expect((draft.segments as object[])[0]).not.toHaveProperty("pacing_wpm");

      const create = vi.fn().mockResolvedValue({
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify(draft) }],
      });

      const manifest = await compileManifest(input, {
        client: { messages: { create } } as never,
      });

      expect(manifest.meta.total_duration_sec).toBe(lengthMin * 60);
      expect(manifest.meta.phase_budget_sec).toEqual(input.session.phase_budget_sec);
      expect(manifest.meta.entrainment_plan).toEqual(input.session.entrainment_plan);
      expect(manifest.segments.map((s) => s.seq)).toEqual(
        manifest.segments.map((_, i) => i + 1),
      );
      expect(manifest.segments.every((s) => s.pacing_wpm > 0)).toBe(true);

      const thetaSteps = [
        ...new Set(
          manifest.segments
            .filter((s) => s.phase === "theta")
            .map((s) => s.step)
            .filter((s): s is number => s != null),
        ),
      ];
      expect(thetaSteps).toEqual(input.skeleton.steps);

      if (input.session.phase_budget_sec.beta === 0) {
        expect(manifest.segments.every((s) => s.phase !== "beta")).toBe(true);
      }
    },
  );

  it("accepts underfill without a second in-process Claude call", async () => {
    const input = buildCompilerInput(15);
    const sparse = modelOwnedManifestDraft(input, { sparseTheta: true });
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(sparse) }],
    });

    const manifest = await compileManifest(input, {
      client: { messages: { create } } as never,
    });

    // Length expand is a separate Inngest step — not a sync re-call here.
    expect(create).toHaveBeenCalledTimes(1);
    expect(manifest.segments.some((s) => s.phase === "theta")).toBe(true);
  });

  it("runs an expand compile when given initialUserMessage (pipeline attempt-2)", async () => {
    const input = buildCompilerInput(15);
    const filled = modelOwnedManifestDraft(input);
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(filled) }],
    });

    const expandMsg = `${JSON.stringify({ expand: true })}\n\nLENGTH UNDERFILL: expand theta`;
    const manifest = await compileManifest(input, {
      client: { messages: { create } } as never,
      initialUserMessage: expandMsg,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].messages[0].content).toBe(expandMsg);
    expect(manifest.segments.some((s) => s.phase === "theta")).toBe(true);
  });

  it("runs script-qa before return so person-agreement errors are fixed pre-synthesis", async () => {
    const input = buildCompilerInput(15);
    const draft = modelOwnedManifestDraft(input) as {
      meta: Record<string, unknown>;
      segments: Array<Record<string, unknown>>;
    };
    const theta = draft.segments.find((s) => s.phase === "theta");
    if (theta && typeof theta.text === "string") {
      theta.text = `You are inside my Hamilton Heights apartment. ${theta.text}`;
    }
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(draft) }],
    });

    const manifest = await compileManifest(input, {
      client: { messages: { create } } as never,
    });

    const thetaText = manifest.segments
      .filter((s) => s.phase === "theta")
      .map((s) => s.text)
      .join(" ");
    expect(thetaText).toContain("your Hamilton Heights apartment");
    expect(thetaText).not.toMatch(/\bmy Hamilton Heights\b/);
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
