import { describe, expect, it } from "vitest";
import { buildCountedSequence, buildSessionSkeleton, BODY_SCAN_CUES } from "./skeleton";
import {
  expandCountedSequenceToMicroSegments,
  spokenCueForBeat,
  spliceCountedSequenceSegments,
} from "./counted-sequence-segments";
import { reconcilePhaseTiming, MAX_SCHEDULED_PAUSE_MS } from "../schedule/reconcile";
import type { CompilerInput } from "../session/derive";
import { DEFAULT_ENTRAINMENT_PLAN } from "../session/derive";

const PAUSE_LABEL_RE = /\b(rest|pause)\b/i;
const LIVE_BREATH_CUE_RE = /^(Breathe in\.|Hold\.|Breathe out\.)$/;

describe("expandCountedSequenceToMicroSegments", () => {
  it("still expands legacy breath kind for gamma energizing-style cues", () => {
    const seq = buildCountedSequence("breath", 2, 40);
    expect(seq.count).toBe(2);
    const micros = expandCountedSequenceToMicroSegments(seq, "alpha", 90);
    expect(micros).toHaveLength(6);
    expect(micros.map((m) => m.text)).toEqual([
      "Breathe in.",
      "Hold.",
      "Breathe out.",
      "Breathe in.",
      "Hold.",
      "Breathe out.",
    ]);
    expect(micros.map((m) => m.pause_after_ms).slice(0, 3)).toEqual([4000, 2000, 10_000]);
  });

  it("countdown speaks only numbers — no rest/pause labels", () => {
    const seq = buildCountedSequence("countdown", 10, 40);
    const micros = expandCountedSequenceToMicroSegments(seq, "alpha", 90);
    expect(micros).toHaveLength(10);
    expect(micros.map((m) => m.text)).toEqual([
      "Ten.",
      "Nine.",
      "Eight.",
      "Seven.",
      "Six.",
      "Five.",
      "Four.",
      "Three.",
      "Two.",
      "One.",
    ]);
    expect(micros.every((m) => !PAUSE_LABEL_RE.test(m.text))).toBe(true);
    for (let i = 0; i < micros.length - 1; i += 1) {
      const spokenSlotMs = seq.beats.filter((b) => b.kind === "count")[i]!.sec * 1000;
      expect(micros[i]!.pause_after_ms).toBe(spokenSlotMs + 1000);
    }
    const lastSpokenMs = seq.beats.filter((b) => b.kind === "count").at(-1)!.sec * 1000;
    expect(micros.at(-1)!.pause_after_ms).toBe(lastSpokenMs);
  });

  it("body scan is one short cue per part with 3–5s pause_after_ms (not a run-on)", () => {
    const seq = buildCountedSequence("body_scan", 10, 60);
    const micros = expandCountedSequenceToMicroSegments(seq, "alpha", 78);
    expect(micros).toHaveLength(10);
    expect(new Set(micros.map((m) => m.text)).size).toBe(10);
    expect(micros.some((m) => /feet.*calves|calves.*thighs/i.test(m.text))).toBe(false);
    for (const micro of micros) {
      expect(micro.title).toMatch(/^counted:body_scan:/);
      expect(micro.pause_after_ms).toBeGreaterThanOrEqual(3_000);
      expect(micro.pause_after_ms).toBeLessThanOrEqual(5_000);
      expect(micro.text.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
    expect(micros[0]?.text).toBe(BODY_SCAN_CUES.feet);
    expect(micros.at(-1)?.text).toBe(BODY_SCAN_CUES.face);
  });

  it("spokenCueForBeat returns null for pause beats", () => {
    expect(spokenCueForBeat({ kind: "pause", sec: 2 })).toBeNull();
    expect(spokenCueForBeat({ kind: "count", n: 7, sec: 2 })).toBe("Seven.");
    expect(spokenCueForBeat({ kind: "inhale", sec: 4 })).toBe("Breathe in.");
    expect(spokenCueForBeat({ kind: "body_part", part: "feet", sec: 2 })).toBe(
      BODY_SCAN_CUES.feet,
    );
  });
});

describe("spliceCountedSequenceSegments (v0.5-1.8)", () => {
  function buildInput(lengthMin: 15 | 30 = 15): CompilerInput {
    const middle_count = lengthMin === 15 ? 2 : 10;
    const skeleton = buildSessionSkeleton({
      length_min: lengthMin,
      middle_start: 2,
      middle_count,
    });
    return {
      goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
      raw: {
        goal_statement: "Test goal.",
        localization: { timeframe: "90d", place: "Place" },
        triangulation: ["aaaaa", "bbbbb", "ccccc"],
        not_list: ["n1", "n2"],
        wrong_direction_pulls: [],
        features: ["email one", "badge two", "paycheck three"],
        sync_actions: [{ action: "send it" }],
      },
      goal_statement: "Test goal.",
      localization: { timeframe: "ninety days", place: "Place" },
      triangulation: ["aaaaa", "bbbbb", "ccccc"],
      not_list: ["n1", "n2"],
      wrong_direction_pulls: [],
      features: ["email one", "badge two", "paycheck three"],
      sync_actions: [{ action: "send it" }],
      senses_emphasis: ["sight", "touch"],
      session: {
        duration_min: lengthMin,
        phase_budget_sec: {
          beta: skeleton.phase_budget.beta_sec,
          alpha: skeleton.phase_budget.alpha_sec,
          theta: skeleton.phase_budget.theta_sec,
          gamma: skeleton.phase_budget.gamma_sec,
        },
        entrainment_plan: DEFAULT_ENTRAINMENT_PLAN,
        person_config: { induction: "second", theta_declarations: "first" },
        pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
        posture: "sitting",
        middle_start: 2,
        middle_count,
      },
      skeleton,
    };
  }

  it("does not splice alpha inhale/hold/exhale cue segments", () => {
    const input = buildInput(15);
    expect(input.skeleton.counted_sequences).not.toHaveProperty("alpha_breath");

    const draft = {
      meta: { goal_version_id: input.goal_version_id },
      segments: [
        {
          phase: "alpha",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.alpha,
          pause_after_ms: 500,
          text:
            "Breathe at your own pace — in for about four, a soft hold for two, and a long exhale for eight. Let the exhale be longer than the inhale. Soften your feet, then your legs.",
        },
        ...input.skeleton.theta_steps.map((t) => ({
          phase: "theta" as const,
          step: t.step,
          target_duration_sec: t.target_sec,
          pause_after_ms: 500,
          text: "I hold the scene.",
        })),
        {
          phase: "gamma",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.gamma,
          pause_after_ms: 500,
          text: "You rise.",
        },
      ],
    };

    const { manifest, actions } = spliceCountedSequenceSegments(draft, input);
    const segments = (
      manifest as { segments: Array<{ phase: string; text: string; title?: string }> }
    ).segments;

    const alpha = segments.filter((s) => s.phase === "alpha");
    expect(alpha.some((s) => LIVE_BREATH_CUE_RE.test(s.text))).toBe(false);
    expect(actions[0]).not.toContain("alpha_breath");

    // Model self-paced instruction preserved in continuous alpha content.
    const modelAlpha = alpha.filter((s) => !s.title?.startsWith("counted:"));
    expect(modelAlpha.some((s) => /in for about four/i.test(s.text))).toBe(true);
    expect(modelAlpha.some((s) => /exhale for eight/i.test(s.text))).toBe(true);

    // Countdown still server-led, numbers only.
    const countdown = alpha.filter((s) => s.title?.startsWith("counted:countdown"));
    expect(countdown).toHaveLength(10);
    expect(countdown.map((s) => s.text)).toEqual([
      "Ten.",
      "Nine.",
      "Eight.",
      "Seven.",
      "Six.",
      "Five.",
      "Four.",
      "Three.",
      "Two.",
      "One.",
    ]);
  });

  it("splices a paced body scan: one short cue per part with real inter-cue silence", () => {
    const input = buildInput(15);
    const draft = {
      meta: { goal_version_id: input.goal_version_id },
      segments: [
        {
          phase: "alpha",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.alpha,
          pause_after_ms: 500,
          text: "Breathe at your own pace — in for about four, a soft hold for two, and a long exhale for eight.",
        },
      ],
    };

    const { manifest, actions } = spliceCountedSequenceSegments(draft, input);
    const segments = (
      manifest as {
        segments: Array<{
          phase: string;
          text: string;
          title?: string;
          pause_after_ms: number;
        }>;
      }
    ).segments;

    const bodyScan = segments.filter((s) => s.title?.startsWith("counted:body_scan"));
    expect(actions[0]).toContain("alpha_body_scan=");
    expect(bodyScan.length).toBeGreaterThanOrEqual(8);
    expect(bodyScan.length).toBeLessThanOrEqual(12);
    // Not one run-on segment packing feet→face into a single breath.
    expect(bodyScan.length).toBe(input.skeleton.counted_sequences.alpha_body_scan.count);

    const parts = input.skeleton.counted_sequences.alpha_body_scan.beats.flatMap((b) =>
      b.kind === "body_part" ? [b.part] : [],
    );
    expect(bodyScan.map((s) => s.text)).toEqual(parts.map((part) => BODY_SCAN_CUES[part]));

    for (const cue of bodyScan) {
      expect(cue.phase).toBe("alpha");
      expect(cue.pause_after_ms).toBeGreaterThanOrEqual(3_000);
      expect(cue.pause_after_ms).toBeLessThanOrEqual(5_000);
      expect(cue.text.split(/\s+/).length).toBeLessThanOrEqual(8);
      // One named area per cue — no packed lists.
      const named = parts.filter((part) => {
        const needle = part === "face" ? "face" : part;
        return cue.text.toLowerCase().includes(needle);
      });
      expect(named.length).toBe(1);
    }

    const alpha = segments.filter((s) => s.phase === "alpha");
    const firstScan = alpha.findIndex((s) => s.title?.startsWith("counted:body_scan"));
    const firstCount = alpha.findIndex((s) => s.title?.startsWith("counted:countdown"));
    expect(firstScan).toBeGreaterThan(0);
    expect(firstCount).toBeGreaterThan(firstScan);
  });

  it("gives model alpha the remainder after body scan + countdown", () => {
    const input = buildInput(15);
    const draft = {
      meta: { goal_version_id: input.goal_version_id },
      segments: [
        {
          phase: "alpha",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.alpha,
          pause_after_ms: 500,
          text: "Breathe at your own pace — in for about four, a soft hold for two, and a long exhale for eight.",
        },
      ],
    };
    const { manifest } = spliceCountedSequenceSegments(draft, input);
    const segments = (
      manifest as { segments: Array<{ phase: string; target_duration_sec: number; title?: string }> }
    ).segments;
    const modelAlphaSec = segments
      .filter((s) => s.phase === "alpha" && !s.title?.startsWith("counted:"))
      .reduce((sum, s) => sum + s.target_duration_sec, 0);
    const countdownSec = input.skeleton.counted_sequences.alpha_countdown.total_sec;
    const bodyScanSec = input.skeleton.counted_sequences.alpha_body_scan.total_sec;
    expect(modelAlphaSec).toBe(
      input.session.phase_budget_sec.alpha - countdownSec - bodyScanSec,
    );
    expect(modelAlphaSec).toBeGreaterThan(0);
    expect(bodyScanSec).toBeGreaterThanOrEqual(60);
  });
});

describe("timing regression acceptance", () => {
  it("never schedules pauses above the cap after reconcile", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 0, alpha: 360, theta: 1980, gamma: 240 },
      segments: [
        { phase: "alpha", pause_after_ms: 500, actual_duration_sec: 20 },
        { phase: "alpha", pause_after_ms: 65_705, actual_duration_sec: 15 },
        { phase: "theta", pause_after_ms: 230_340, actual_duration_sec: 40 },
        { phase: "theta", pause_after_ms: 500, actual_duration_sec: 50 },
      ],
    });
    for (const segment of result.segments) {
      expect(segment.scheduled_pause_after_ms).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
    }
  });

  it("allows intentional long countdown silence up to the cap", () => {
    const result = reconcilePhaseTiming({
      phaseBudgetSec: { beta: 0, alpha: 360, theta: 1980, gamma: 240 },
      segments: [
        { phase: "alpha", pause_after_ms: 4000, actual_duration_sec: 0.5 },
        { phase: "alpha", pause_after_ms: 2000, actual_duration_sec: 0.4 },
        { phase: "alpha", pause_after_ms: 10_000, actual_duration_sec: 0.5 },
      ],
    });
    expect(result.segments[2]?.scheduled_pause_after_ms).toBe(10_000);
  });

  it("session wall-clock stays near length without multi-minute dead air", () => {
    const skeleton = buildSessionSkeleton({ length_min: 15 });
    const input: CompilerInput = {
      goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
      raw: {
        goal_statement: "Test goal.",
        localization: { timeframe: "90d", place: "Place" },
        triangulation: ["aaaaa", "bbbbb", "ccccc"],
        not_list: ["n1", "n2"],
        wrong_direction_pulls: [],
        features: ["email one", "badge two", "paycheck three"],
        sync_actions: [{ action: "send it" }],
      },
      goal_statement: "Test goal.",
      localization: { timeframe: "ninety days", place: "Place" },
      triangulation: ["aaaaa", "bbbbb", "ccccc"],
      not_list: ["n1", "n2"],
      wrong_direction_pulls: [],
      features: ["email one", "badge two", "paycheck three"],
      sync_actions: [{ action: "send it" }],
      senses_emphasis: ["sight", "touch"],
      session: {
        duration_min: 15,
        phase_budget_sec: {
          beta: skeleton.phase_budget.beta_sec,
          alpha: skeleton.phase_budget.alpha_sec,
          theta: skeleton.phase_budget.theta_sec,
          gamma: skeleton.phase_budget.gamma_sec,
        },
        entrainment_plan: DEFAULT_ENTRAINMENT_PLAN,
        person_config: { induction: "second", theta_declarations: "first" },
        pacing: { beta_wpm: 130, alpha_wpm: 90, theta_wpm: 105, gamma_wpm: 150 },
        posture: "sitting",
        middle_start: 2,
        middle_count: 2,
      },
      skeleton,
    };

    const draft = {
      meta: { goal_version_id: input.goal_version_id },
      segments: [
        {
          phase: "beta",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.beta,
          pause_after_ms: 500,
          text: "You begin.",
        },
        {
          phase: "alpha",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.alpha,
          pause_after_ms: 500,
          text: "Breathe at your own pace — in for about four, a soft hold for two, and a long exhale for eight. You soften the body.",
        },
        ...input.skeleton.theta_steps.map((t) => ({
          phase: "theta" as const,
          step: t.step,
          target_duration_sec: t.target_sec,
          pause_after_ms: 500,
          text: "I hold the scene.",
        })),
        {
          phase: "gamma",
          step: null,
          target_duration_sec: input.session.phase_budget_sec.gamma,
          pause_after_ms: 500,
          text: "You rise.",
        },
      ],
    };

    const { manifest } = spliceCountedSequenceSegments(draft, input);
    const segments = (
      manifest as {
        segments: Array<{
          phase: "beta" | "alpha" | "theta" | "gamma";
          pause_after_ms: number;
          target_duration_sec: number;
          text: string;
        }>;
      }
    ).segments;

    const alphaLiveCues = segments.filter(
      (s) => s.phase === "alpha" && LIVE_BREATH_CUE_RE.test(s.text),
    );
    expect(alphaLiveCues).toHaveLength(0);

    const forReconcile = segments.map((s) => ({
      phase: s.phase,
      pause_after_ms: s.pause_after_ms,
      actual_duration_sec: Math.max(0.5, s.target_duration_sec * 0.35),
    }));

    const reconciled = reconcilePhaseTiming({
      phaseBudgetSec: input.session.phase_budget_sec,
      segments: forReconcile,
    });

    for (const segment of reconciled.segments) {
      expect(segment.scheduled_pause_after_ms).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
    }

    const wallSec = reconciled.segments.reduce(
      (sum, s) => sum + s.actual_duration_sec + (s.scheduled_pause_after_ms ?? 0) / 1000,
      0,
    );
    const budgetSec = 15 * 60;
    expect(wallSec).toBeLessThanOrEqual(budgetSec * 1.05);
    const maxPause = Math.max(...reconciled.segments.map((s) => s.scheduled_pause_after_ms ?? 0));
    expect(maxPause).toBeLessThanOrEqual(MAX_SCHEDULED_PAUSE_MS);
  });
});
