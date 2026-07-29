import { describe, expect, it, vi, afterEach } from "vitest";
import { buildSessionSkeleton } from "../compiler/skeleton";
import { compileManifest } from "../compiler/compile";
import {
  assessCompileLength,
  resolveCompileFailOpen,
  runCompileAttempt2FailOpen,
  shouldRunCompileAttempt2,
} from "./compile-length-steps";
import type { CompilerInput } from "../session/derive";
import { DEFAULT_ENTRAINMENT_PLAN } from "../session/derive";
import type { Manifest } from "../contracts/manifest";

function padWords(n: number): string {
  const unit = "I hold the scene with steady focus and clear sensory detail";
  const words = unit.split(/\s+/);
  const out: string[] = [];
  while (out.length < n) out.push(...words);
  return out.slice(0, Math.max(n, 1)).join(" ");
}

function buildInput(lengthMin: 15 = 15): CompilerInput {
  const skeleton = buildSessionSkeleton({
    length_min: lengthMin,
    middle_start: 2,
    middle_count: 2,
  });
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
      phase_budget_sec: {
        beta: skeleton.phase_budget.beta_sec,
        alpha: skeleton.phase_budget.alpha_sec,
        theta: skeleton.phase_budget.theta_sec,
        gamma: skeleton.phase_budget.gamma_sec,
      },
      entrainment_plan: [...DEFAULT_ENTRAINMENT_PLAN],
      person_config: { induction: "second", theta_declarations: "first" },
      pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
      posture: "sitting",
      middle_start: 2,
      middle_count: 2,
    },
    skeleton,
  };
}

function sparseDraft(input: CompilerInput): Record<string, unknown> {
  const budget = input.session.phase_budget_sec;
  return {
    meta: { goal_version_id: input.goal_version_id },
    segments: [
      {
        phase: "beta",
        step: null,
        target_duration_sec: budget.beta,
        pause_after_ms: 500,
        text: "You begin.",
      },
      {
        phase: "alpha",
        step: null,
        target_duration_sec: budget.alpha,
        pause_after_ms: 500,
        text: "You soften.",
      },
      ...input.skeleton.theta_steps.map((t) => ({
        phase: "theta",
        step: t.step,
        target_duration_sec: t.target_sec,
        pause_after_ms: 500,
        text: "I hold a thin scene.",
      })),
      {
        phase: "gamma",
        step: null,
        target_duration_sec: budget.gamma,
        pause_after_ms: 500,
        text: "You rise.",
      },
    ],
  };
}

function filledDraft(input: CompilerInput): Record<string, unknown> {
  const budget = input.session.phase_budget_sec;
  const pacing = input.session.pacing;
  return {
    meta: { goal_version_id: input.goal_version_id },
    segments: [
      {
        phase: "beta",
        step: null,
        target_duration_sec: budget.beta,
        pause_after_ms: 500,
        text: padWords(Math.ceil((pacing.beta_wpm * budget.beta) / 60)),
      },
      {
        phase: "alpha",
        step: null,
        target_duration_sec: budget.alpha,
        pause_after_ms: 500,
        text: padWords(Math.ceil((pacing.alpha_wpm * budget.alpha * 0.75) / 60)),
      },
      ...input.skeleton.theta_steps.map((t) => ({
        phase: "theta",
        step: t.step,
        target_duration_sec: t.target_sec,
        pause_after_ms: 500,
        text: padWords(t.target_words),
      })),
      {
        phase: "gamma",
        step: null,
        target_duration_sec: budget.gamma,
        pause_after_ms: 500,
        text: padWords(Math.ceil((pacing.gamma_wpm * budget.gamma) / 60)),
      },
    ],
  };
}

describe("compile-length-steps (v0.5-1.12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flags underwrite and builds expand message for a separate compile step", async () => {
    const input = buildInput();
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(sparseDraft(input)) }],
    });
    const attempt1 = await compileManifest(input, {
      client: { messages: { create } } as never,
    });
    expect(create).toHaveBeenCalledTimes(1);

    const check = assessCompileLength(attempt1, input);
    expect(check.underfilled).toBe(true);
    expect(shouldRunCompileAttempt2(check)).toBe(true);
    expect(check.expandUserMessage).toContain("LENGTH UNDERFILL");
    expect(check.expandUserMessage).toContain("Do not add steps");
  });

  it("schedules attempt-2 as a separate call, not a sync re-call in attempt-1", async () => {
    const input = buildInput();
    const create1 = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(sparseDraft(input)) }],
    });
    const attempt1 = await compileManifest(input, {
      client: { messages: { create: create1 } } as never,
    });
    const check = assessCompileLength(attempt1, input);
    expect(shouldRunCompileAttempt2(check)).toBe(true);

    const create2 = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(filledDraft(input)) }],
    });
    const attempt2 = await runCompileAttempt2FailOpen(
      input,
      check.expandUserMessage!,
      { client: { messages: { create: create2 } } as never },
    );

    expect(create1).toHaveBeenCalledTimes(1);
    expect(create2).toHaveBeenCalledTimes(1);
    expect(create2.mock.calls[0]![0].messages[0].content).toContain("LENGTH UNDERFILL");
    expect(attempt2).not.toBeNull();

    const chosen = resolveCompileFailOpen({ attempt1, attempt2 });
    expect(chosen.segments.some((s) => s.phase === "theta")).toBe(true);
    // Pipeline always has a playable manifest (never hangs / null).
    expect(chosen.meta.total_duration_sec).toBe(15 * 60);
  });

  it("fail-open keeps attempt-1 when attempt-2 fails", async () => {
    const input = buildInput();
    const create1 = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(sparseDraft(input)) }],
    });
    const attempt1 = await compileManifest(input, {
      client: { messages: { create: create1 } } as never,
    });
    const check = assessCompileLength(attempt1, input);

    const create2 = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "{not json" }],
    });
    const attempt2 = await runCompileAttempt2FailOpen(
      input,
      check.expandUserMessage!,
      { client: { messages: { create: create2 } } as never },
    );
    expect(attempt2).toBeNull();

    const chosen = resolveCompileFailOpen({ attempt1, attempt2 });
    expect(chosen).toBe(attempt1);
    expect(chosen.segments.length).toBeGreaterThan(0);
  });

  it("does not schedule attempt-2 when content already meets 97%", async () => {
    const input = buildInput();
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(filledDraft(input)) }],
    });
    const attempt1 = await compileManifest(input, {
      client: { messages: { create } } as never,
    });
    const check = assessCompileLength(attempt1, input);
    expect(check.underfilled).toBe(false);
    expect(shouldRunCompileAttempt2(check)).toBe(false);
    expect(check.expandUserMessage).toBeNull();
  });

  it("resolveCompileFailOpen never returns empty — synthesis can always proceed", () => {
    const stub = { meta: { total_duration_sec: 900 }, segments: [{ seq: 1 }] } as unknown as Manifest;
    expect(resolveCompileFailOpen({ attempt1: stub, attempt2: null })).toBe(stub);
    const better = { ...stub, meta: { ...stub.meta, total_duration_sec: 900 } } as Manifest;
    expect(resolveCompileFailOpen({ attempt1: stub, attempt2: better })).toBe(better);
  });
});
