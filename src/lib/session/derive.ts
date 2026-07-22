import type { Intake } from "../contracts/intake";
import { PACING_WPM, type DurationPreset } from "../costs";
import {
  buildSessionSkeleton,
  type Posture,
  type SessionSkeleton,
} from "../compiler/skeleton";
import { formatSkeletonForPrompt } from "../compiler/prompt.v2";
import {
  toSpeakableText,
  normalizeDeadlineValue,
  normalizeTimeframeValue,
} from "../compiler/speech-normalize";

export const DEFAULT_ENTRAINMENT_PLAN = [
  { phase: "beta" as const, hz: 18, glide_to: 10, glide_sec: 45 },
  { phase: "alpha" as const, hz: 10, glide_to: 6, glide_sec: 60 },
  { phase: "theta" as const, hz: 6, glide_to: null },
  { phase: "gamma" as const, hz: 40, glide_sec: 30 },
];

export const DEFAULT_PERSON_CONFIG = {
  induction: "second" as const,
  theta_declarations: "first" as const,
};

export type PhaseBudgetSec = {
  beta: number;
  alpha: number;
  theta: number;
  gamma: number;
};

export interface DerivedSession {
  duration_min: DurationPreset;
  phase_budget_sec: PhaseBudgetSec;
  entrainment_plan: typeof DEFAULT_ENTRAINMENT_PLAN | Omit<
    (typeof DEFAULT_ENTRAINMENT_PLAN)[number],
    never
  >[];
  person_config: typeof DEFAULT_PERSON_CONFIG;
  pacing: {
    beta_wpm: number;
    alpha_wpm: number;
    theta_wpm: number;
    gamma_wpm: number;
  };
  posture: Posture;
  middle_start: number;
  middle_count: number;
}

function entrainmentPlanForBudget(budget: PhaseBudgetSec): DerivedSession["entrainment_plan"] {
  if (budget.beta === 0) {
    return DEFAULT_ENTRAINMENT_PLAN.filter((entry) => entry.phase !== "beta");
  }
  return DEFAULT_ENTRAINMENT_PLAN;
}

export function skeletonFromIntake(intake: Intake): SessionSkeleton {
  return buildSessionSkeleton({
    length_min: intake.session.duration_min,
    middle_start: intake.session.middle_start,
    middle_count: intake.session.middle_count,
    posture: intake.session.posture,
  });
}

export function deriveSessionFromIntake(intake: Intake): DerivedSession {
  const skeleton = skeletonFromIntake(intake);
  const phase_budget_sec: PhaseBudgetSec = {
    beta: skeleton.phase_budget.beta_sec,
    alpha: skeleton.phase_budget.alpha_sec,
    theta: skeleton.phase_budget.theta_sec,
    gamma: skeleton.phase_budget.gamma_sec,
  };
  return {
    duration_min: skeleton.length_min,
    phase_budget_sec,
    entrainment_plan: entrainmentPlanForBudget(phase_budget_sec),
    person_config: DEFAULT_PERSON_CONFIG,
    pacing: {
      beta_wpm: PACING_WPM.beta,
      alpha_wpm: PACING_WPM.alpha,
      theta_wpm: PACING_WPM.theta,
      gamma_wpm: PACING_WPM.gamma,
    },
    posture: skeleton.posture,
    middle_start: intake.session.middle_start,
    middle_count: intake.session.middle_count,
  };
}

export interface CompilerIntakeSnapshot {
  goal_statement: string;
  localization: Intake["localization"];
  triangulation: Intake["triangulation"];
  not_list: Intake["not_list"];
  wrong_direction_pulls: Intake["wrong_pulls"];
  features: Intake["features"];
  sync_actions: Intake["sync_actions"];
}

export interface CompilerInput {
  goal_version_id: string;
  raw: CompilerIntakeSnapshot;
  goal_statement: string;
  localization: { timeframe: string; place: string };
  triangulation: Intake["triangulation"];
  not_list: Intake["not_list"];
  wrong_direction_pulls: Intake["wrong_pulls"];
  features: Intake["features"];
  sync_actions: Intake["sync_actions"];
  senses_emphasis: string[];
  aos_layer?: Intake["session"]["aos_layer"];
  session: DerivedSession;
  /** Server-owned skeleton; stripped from model payload and re-injected formatted. */
  skeleton: SessionSkeleton;
}

function snapshotIntakeFields(intake: Intake): CompilerIntakeSnapshot {
  return {
    goal_statement: intake.goal_statement,
    localization: intake.localization,
    triangulation: intake.triangulation,
    not_list: intake.not_list,
    wrong_direction_pulls: intake.wrong_pulls,
    features: intake.features,
    sync_actions: intake.sync_actions,
  };
}

export function compilerInputForModel(
  input: CompilerInput,
): Omit<CompilerInput, "raw" | "skeleton"> & {
  skeleton: ReturnType<typeof formatSkeletonForPrompt>;
} {
  const { raw, skeleton, ...modelInput } = input;
  void raw;
  return {
    ...modelInput,
    skeleton: formatSkeletonForPrompt(skeleton),
  };
}

export function buildCompilerInput(intake: Intake, goalVersionId: string): CompilerInput {
  const skeleton = skeletonFromIntake(intake);
  const session = deriveSessionFromIntake(intake);
  const raw = snapshotIntakeFields(intake);

  return {
    goal_version_id: goalVersionId,
    raw,
    goal_statement: toSpeakableText(intake.goal_statement),
    localization: {
      timeframe: normalizeTimeframeValue(intake.localization.timeframe),
      place: toSpeakableText(intake.localization.place),
    },
    triangulation: intake.triangulation.map((item) => toSpeakableText(item)) as Intake["triangulation"],
    not_list: intake.not_list.map((item) => toSpeakableText(item)),
    wrong_direction_pulls: intake.wrong_pulls.map((item) => toSpeakableText(item)),
    features: intake.features.map((item) => toSpeakableText(item)),
    sync_actions: intake.sync_actions.map((action) => ({
      action: toSpeakableText(action.action),
      ...(action.deadline ? { deadline: normalizeDeadlineValue(action.deadline) } : {}),
    })),
    senses_emphasis: intake.session.senses_emphasis,
    ...(intake.session.aos_layer ? { aos_layer: intake.session.aos_layer } : {}),
    session,
    skeleton,
  };
}
