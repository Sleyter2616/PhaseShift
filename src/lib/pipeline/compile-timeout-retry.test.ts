import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionSkeleton } from "../compiler/skeleton";
import {
  COMPILE_STEP_BUDGET_MS,
  CompilerError,
  compileManifestWithBudget,
} from "../compiler/compile";
import type { CompilerInput } from "../session/derive";
import { DEFAULT_ENTRAINMENT_PLAN } from "../session/derive";
import {
  runCompilePrimaryAttempt,
  shouldRetryCompileOnTimeout,
} from "./compile-timeout-retry";

function padWords(n: number): string {
  const unit = "I hold the scene with steady focus and clear sensory detail";
  const words = unit.split(/\s+/);
  const out: string[] = [];
  while (out.length < n) out.push(...words);
  return out.slice(0, Math.max(n, 1)).join(" ");
}

function buildInput(lengthMin: 15 | 45 = 15): CompilerInput {
  const middle_count = lengthMin === 15 ? 2 : 10;
  const skeleton = buildSessionSkeleton({
    length_min: lengthMin,
    middle_start: 2,
    middle_count,
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
      middle_count,
    },
    skeleton,
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

describe("compile timeout resilience", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("soft budget is ~270s against the 300s Inngest maxDuration", () => {
    expect(COMPILE_STEP_BUDGET_MS).toBe(270_000);
    // Leave ~30s headroom before Vercel/Inngest hard kill (route maxDuration=300).
    expect(300_000 - COMPILE_STEP_BUDGET_MS).toBe(30_000);
  });

  it("runCompilePrimaryAttempt returns timeout (does not throw) on soft budget", async () => {
    vi.useFakeTimers();
    const input = buildInput();
    const create = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves — soft budget must win */
        }),
    );

    const pending = runCompilePrimaryAttempt(input, {
      budgetMs: 50,
      client: { messages: { create } } as never,
    });
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.message).toContain("exceeded 50ms");
      expect(shouldRetryCompileOnTimeout(result)).toBe(true);
    }
  });

  it("soft-timeout then successful separate retry completes generation path", async () => {
    vi.useFakeTimers();
    const input = buildInput();
    let calls = 0;
    const create = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise(() => {
          /* first pass hangs past soft budget */
        });
      }
      return Promise.resolve({
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text: JSON.stringify(filledDraft(input)) }],
      });
    });

    const options = {
      budgetMs: 50,
      client: { messages: { create } } as never,
    };

    const firstPending = runCompilePrimaryAttempt(input, options);
    await vi.advanceTimersByTimeAsync(50);
    const first = await firstPending;
    expect(shouldRetryCompileOnTimeout(first)).toBe(true);

    // Separate "step" retry — fresh budget, same helper (mirrors generate-script).
    const retry = await runCompilePrimaryAttempt(input, options);
    expect(retry.status).toBe("ok");
    if (retry.status === "ok") {
      expect(retry.manifest.segments.length).toBeGreaterThan(0);
    }
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("fails only after the separate-step retry also times out", async () => {
    vi.useFakeTimers();
    const input = buildInput();
    const create = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          /* both passes hang */
        }),
    );
    const options = {
      budgetMs: 40,
      client: { messages: { create } } as never,
    };

    const firstPending = runCompilePrimaryAttempt(input, options);
    await vi.advanceTimersByTimeAsync(40);
    const first = await firstPending;
    expect(shouldRetryCompileOnTimeout(first)).toBe(true);

    // Minutes stay spent; no refund yet — retry is a separate step with a fresh budget.
    const retryPending = runCompilePrimaryAttempt(input, options);
    await vi.advanceTimersByTimeAsync(40);
    const retry = await retryPending;
    expect(retry.status).toBe("timeout");
    // Terminal failure → markScriptFailed refunds once (idempotent ledger).
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("CompilerError still throws from primary attempt (no silent swallow)", async () => {
    const input = buildInput();
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "{not-json" }],
    });

    await expect(
      runCompilePrimaryAttempt(input, {
        client: { messages: { create } } as never,
      }),
    ).rejects.toBeInstanceOf(CompilerError);
  });

  it("compileManifestWithBudget logs duration on success", async () => {
    const input = buildInput(45);
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(filledDraft(input)) }],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await compileManifestWithBudget(input, {
      client: { messages: { create } } as never,
    });

    expect(
      log.mock.calls.some(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes("outcome=ok") &&
          args[0].includes("length_min=45") &&
          args[0].includes("duration_ms="),
      ),
    ).toBe(true);
  });
});
