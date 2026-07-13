import type { Intake } from "../contracts/intake";
import { PACING_WPM, PHASE_BUDGET_SEC, type DurationPreset } from "../costs";
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

export interface DerivedSession {
  duration_min: DurationPreset;
  phase_budget_sec: (typeof PHASE_BUDGET_SEC)[DurationPreset];
  entrainment_plan: typeof DEFAULT_ENTRAINMENT_PLAN;
  person_config: typeof DEFAULT_PERSON_CONFIG;
  pacing: {
    beta_wpm: number;
    alpha_wpm: number;
    theta_wpm: number;
    gamma_wpm: number;
  };
}

export function deriveSessionFromIntake(intake: Intake): DerivedSession {
  const duration_min = intake.session.duration_min;
  return {
    duration_min,
    phase_budget_sec: PHASE_BUDGET_SEC[duration_min],
    entrainment_plan: DEFAULT_ENTRAINMENT_PLAN,
    person_config: DEFAULT_PERSON_CONFIG,
    pacing: {
      beta_wpm: PACING_WPM.beta,
      alpha_wpm: PACING_WPM.alpha,
      theta_wpm: PACING_WPM.theta,
      gamma_wpm: PACING_WPM.gamma,
    },
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
): Omit<CompilerInput, "raw"> {
  const { raw, ...modelInput } = input;
  void raw;
  return modelInput;
}

export function buildCompilerInput(intake: Intake, goalVersionId: string): CompilerInput {
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
  };
}
