import type { CompilerInput } from "../session/derive";
import {
  EMPTY_WIZARD_DRAFT,
  withSessionLength,
  type WizardDraft,
  type WizardLengthMin,
} from "./wizard";
import { isSessionLengthMin } from "../compiler/skeleton";

export type PriorSessionOption = {
  id: string;
  created_at: string;
  goal_statement: string;
  duration_min: number | null;
};

function asLengthMin(value: unknown): WizardLengthMin {
  if (typeof value === "number" && isSessionLengthMin(value)) return value;
  return EMPTY_WIZARD_DRAFT.session.duration_min;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asTriangulation(value: unknown): WizardDraft["triangulation"] {
  const items = asStringArray(value);
  return [items[0] ?? "", items[1] ?? "", items[2] ?? ""];
}

function asSyncActions(value: unknown): WizardDraft["sync_actions"] {
  if (!Array.isArray(value) || value.length === 0) return [{ action: "" }];
  const actions = value
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const record = item as Record<string, unknown>;
      if (typeof record.action !== "string" || !record.action.trim()) return null;
      return {
        action: record.action,
        ...(typeof record.deadline === "string" && record.deadline
          ? { deadline: record.deadline }
          : {}),
      };
    })
    .filter((item): item is { action: string; deadline?: string } => item != null);
  return actions.length > 0 ? actions : [{ action: "" }];
}

/**
 * Prefill a wizard draft from a prior script's persisted compiler_input
 * (raw intake answers + session prefs) plus script-row voice/entrainment.
 */
export function draftFromPriorScript(args: {
  compilerInput: unknown;
  entrainment_mode?: string | null;
  voice_profile_id?: string | null;
  stock_voice_id?: string | null;
}): WizardDraft | null {
  const input = args.compilerInput as CompilerInput | null;
  if (!input || typeof input !== "object" || !input.raw) return null;

  const raw = input.raw;
  const lengthMin = asLengthMin(input.session?.duration_min);
  const senses =
    Array.isArray(input.senses_emphasis) && input.senses_emphasis.length >= 2
      ? input.senses_emphasis.filter((s): s is string => typeof s === "string")
      : EMPTY_WIZARD_DRAFT.session.senses_emphasis;

  const entrainment =
    args.entrainment_mode === "binaural" || args.entrainment_mode === "isochronic"
      ? args.entrainment_mode
      : EMPTY_WIZARD_DRAFT.session.entrainment_mode;

  const aos =
    input.aos_layer === "ego" ||
    input.aos_layer === "self" ||
    input.aos_layer === "persona" ||
    input.aos_layer === "shadow"
      ? input.aos_layer
      : undefined;

  const baseSession = withSessionLength(
    {
      ...EMPTY_WIZARD_DRAFT.session,
      posture:
        input.session?.posture === "lying" || input.session?.posture === "sitting"
          ? input.session.posture
          : "sitting",
      entrainment_mode: entrainment,
      senses_emphasis: senses,
      ...(aos ? { aos_layer: aos } : {}),
    },
    lengthMin,
  );

  return {
    goal_statement: typeof raw.goal_statement === "string" ? raw.goal_statement : "",
    localization: {
      timeframe:
        typeof raw.localization?.timeframe === "string"
          ? raw.localization.timeframe
          : EMPTY_WIZARD_DRAFT.localization.timeframe,
      place: typeof raw.localization?.place === "string" ? raw.localization.place : "",
    },
    triangulation: asTriangulation(raw.triangulation),
    not_list: asStringArray(raw.not_list),
    wrong_pulls: asStringArray(raw.wrong_direction_pulls),
    features: asStringArray(raw.features),
    sync_actions: asSyncActions(raw.sync_actions),
    session: baseSession,
    voice_profile_id: args.voice_profile_id ?? null,
    stock_voice_id: args.stock_voice_id ?? null,
  };
}

export function summarizePriorSession(args: {
  id: string;
  created_at: string;
  compiler_input: unknown;
}): PriorSessionOption | null {
  const input = args.compiler_input as CompilerInput | null;
  const goal =
    typeof input?.raw?.goal_statement === "string"
      ? input.raw.goal_statement
      : typeof input?.goal_statement === "string"
        ? input.goal_statement
        : null;
  if (!goal?.trim()) return null;

  const duration =
    typeof input?.session?.duration_min === "number" ? input.session.duration_min : null;

  return {
    id: args.id,
    created_at: args.created_at,
    goal_statement: goal.trim(),
    duration_min: duration,
  };
}
