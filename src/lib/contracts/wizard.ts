import {
  intakeSchema,
  WIZARD_STEP_SCHEMAS,
  type Intake,
} from "./intake";

export interface WizardDraft {
  goal_statement: string;
  localization: { timeframe: string; place: string };
  triangulation: [string, string, string];
  not_list: string[];
  wrong_pulls: string[];
  features: string[];
  sync_actions: { action: string; deadline?: string }[];
  session: {
    duration_min: 45;
    middle_start: number;
    middle_count: number;
    posture: "sitting" | "lying";
    entrainment_mode: "binaural" | "isochronic";
    senses_emphasis: string[];
    aos_layer?: "ego" | "self" | "persona" | "shadow";
  };
  voice_profile_id: string | null;
  /** Selected ElevenLabs stock voice id when not using own voice. */
  stock_voice_id: string | null;
}

export const EMPTY_WIZARD_DRAFT: WizardDraft = {
  goal_statement: "",
  localization: { timeframe: "90d", place: "" },
  triangulation: ["", "", ""],
  not_list: [],
  wrong_pulls: [],
  features: [],
  sync_actions: [{ action: "" }],
  session: {
    duration_min: 45,
    middle_start: 2,
    middle_count: 10,
    posture: "sitting",
    entrainment_mode: "isochronic",
    senses_emphasis: ["sight", "touch"],
  },
  voice_profile_id: null,
  stock_voice_id: null,
};

function stepPayload(step: number, draft: WizardDraft): unknown {
  switch (step) {
    case 1:
      return { goal_statement: draft.goal_statement };
    case 2:
      return { localization: draft.localization };
    case 3:
      return { triangulation: draft.triangulation };
    case 4:
      return { not_list: draft.not_list, wrong_pulls: draft.wrong_pulls };
    case 5:
      return { features: draft.features };
    case 6:
      return { sync_actions: draft.sync_actions };
    case 7:
      return { session: draft.session };
    default:
      return {};
  }
}

export function validateWizardStep(step: number, draft: WizardDraft): string | null {
  const index = step - 1;
  if (index < 0 || index >= WIZARD_STEP_SCHEMAS.length) {
    return "invalid step";
  }
  const result = WIZARD_STEP_SCHEMAS[index]!.safeParse(stepPayload(step, draft));
  if (result.success) return null;
  return result.error.issues[0]?.message ?? "validation failed";
}

export function draftToIntake(draft: WizardDraft): Intake {
  return intakeSchema.parse({
    goal_statement: draft.goal_statement,
    localization: draft.localization,
    triangulation: draft.triangulation,
    not_list: draft.not_list,
    wrong_pulls: draft.wrong_pulls,
    features: draft.features,
    sync_actions: draft.sync_actions.filter((item) => item.action.trim().length > 0),
    session: {
      ...draft.session,
      duration_min: 45,
      middle_start: 2,
      middle_count: 10,
      posture: draft.session.posture ?? "sitting",
    },
  });
}
