import { describe, expect, it } from "vitest";
import { PACING_WPM } from "../costs";
import type { Manifest } from "../contracts/manifest";
import { buildSessionSkeleton, type SessionLengthMin } from "./skeleton";
import {
  collectThetaFillErrors,
  countSpeakableWords,
  formatThetaStepsForPrompt,
  stampThetaReflectivePauses,
  THETA_REFLECTIVE_PAUSE_MS,
  thetaMinWords,
  thetaWordBudget,
} from "./theta-fill";

function middleCountFor(lengthMin: SessionLengthMin): number {
  if (lengthMin === 10) return 1;
  if (lengthMin === 15) return 2;
  if (lengthMin === 30) return 6;
  return 10;
}

function padWords(minWords: number): string {
  const unit = "I hold the scene with steady focus and clear sensory detail";
  const words = unit.split(/\s+/);
  const out: string[] = [];
  while (out.length < minWords) {
    out.push(...words);
  }
  return out.slice(0, minWords).join(" ");
}

describe("theta-fill", () => {
  it.each([15, 30, 45] as const)(
    "%s-min skeleton theta targets sum to theta_sec and stay distributed",
    (lengthMin) => {
      const skeleton = buildSessionSkeleton({
        length_min: lengthMin,
        middle_start: 2,
        middle_count: middleCountFor(lengthMin),
      });
      const sum = skeleton.theta_steps.reduce((acc, step) => acc + step.target_sec, 0);
      expect(sum).toBe(skeleton.phase_budget.theta_sec);

      const totalSec = lengthMin * 60;
      const phaseSum =
        skeleton.phase_budget.beta_sec +
        skeleton.phase_budget.alpha_sec +
        skeleton.phase_budget.theta_sec +
        skeleton.phase_budget.gamma_sec;
      expect(phaseSum).toBe(totalSec);
      expect(Math.abs(phaseSum - totalSec) / totalSec).toBeLessThanOrEqual(0.1);

      expect(skeleton.theta_steps.length).toBe(skeleton.steps.length);
      expect(skeleton.theta_steps.every((step) => step.target_sec >= 60)).toBe(true);
      const maxShare = Math.max(
        ...skeleton.theta_steps.map((step) => step.target_sec / skeleton.phase_budget.theta_sec),
      );
      // Not collapsed onto a single step.
      expect(maxShare).toBeLessThan(0.75);
    },
  );

  it("formatThetaStepsForPrompt exposes target_words and min_words", () => {
    const skeleton = buildSessionSkeleton({
      length_min: 15,
      middle_start: 2,
      middle_count: 2,
    });
    const formatted = formatThetaStepsForPrompt(skeleton.theta_steps, PACING_WPM.theta);
    expect(formatted[0]).toMatchObject({
      step: skeleton.theta_steps[0]!.step,
      target_sec: skeleton.theta_steps[0]!.target_sec,
      target_words: Math.round(thetaWordBudget(skeleton.theta_steps[0]!.target_sec)),
      min_words: thetaMinWords(skeleton.theta_steps[0]!.target_sec),
    });
  });

  it("collectThetaFillErrors flags underfilled steps", () => {
    const skeleton = buildSessionSkeleton({
      length_min: 15,
      middle_start: 2,
      middle_count: 2,
    });
    const segments = skeleton.theta_steps.map((timing, index) => ({
      seq: index + 1,
      phase: "theta" as const,
      step: timing.step,
      pacing_wpm: PACING_WPM.theta,
      target_duration_sec: timing.target_sec,
      pause_after_ms: 0,
      text: "I see one thin line.",
    }));
    const manifest = {
      meta: {
        goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
        total_duration_sec: 900,
        phase_budget_sec: {
          beta: skeleton.phase_budget.beta_sec,
          alpha: skeleton.phase_budget.alpha_sec,
          theta: skeleton.phase_budget.theta_sec,
          gamma: skeleton.phase_budget.gamma_sec,
        },
        entrainment_plan: [],
      },
      segments,
    } as Manifest;

    const errors = collectThetaFillErrors(manifest, skeleton);
    expect(errors.some((error) => error.includes("UNDERFILLED"))).toBe(true);
  });

  it("collectThetaFillErrors accepts word floors at 85%", () => {
    const skeleton = buildSessionSkeleton({
      length_min: 15,
      middle_start: 2,
      middle_count: 2,
    });
    const segments = skeleton.theta_steps.map((timing, index) => ({
      seq: index + 1,
      phase: "theta" as const,
      step: timing.step,
      pacing_wpm: PACING_WPM.theta,
      target_duration_sec: timing.target_sec,
      pause_after_ms: 0,
      text: padWords(thetaMinWords(timing.target_sec)),
    }));
    const manifest = {
      meta: {
        goal_version_id: "550e8400-e29b-41d4-a716-446655440000",
        total_duration_sec: 900,
        phase_budget_sec: {
          beta: skeleton.phase_budget.beta_sec,
          alpha: skeleton.phase_budget.alpha_sec,
          theta: skeleton.phase_budget.theta_sec,
          gamma: skeleton.phase_budget.gamma_sec,
        },
        entrainment_plan: [],
      },
      segments,
    } as Manifest;

    expect(collectThetaFillErrors(manifest, skeleton)).toEqual([]);
    expect(countSpeakableWords(segments[0]!.text)).toBeGreaterThanOrEqual(
      thetaMinWords(skeleton.theta_steps[0]!.target_sec),
    );
  });

  it("stampThetaReflectivePauses sets ~4s between steps, not after final", () => {
    const segments = [
      {
        seq: 1,
        phase: "theta" as const,
        step: 1,
        pause_after_ms: 500,
      },
      {
        seq: 2,
        phase: "theta" as const,
        step: 2,
        pause_after_ms: 9000,
      },
      {
        seq: 3,
        phase: "theta" as const,
        step: 12,
        pause_after_ms: 0,
      },
    ];
    const { segments: stamped, actions } = stampThetaReflectivePauses(segments);
    expect(stamped[0]!.pause_after_ms).toBe(THETA_REFLECTIVE_PAUSE_MS);
    expect(stamped[1]!.pause_after_ms).toBe(THETA_REFLECTIVE_PAUSE_MS);
    expect(stamped[2]!.pause_after_ms).toBe(0);
    expect(actions.length).toBe(2);
  });
});
