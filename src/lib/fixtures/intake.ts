import type { Intake } from "../contracts/intake";

/** Golden fixtures intentionally contain no `<break>` SSML tags (intake layer only). */

export const intake45Min: Intake = {
  goal_statement: "The senior engineer role at Meridian Labs is mine now.",
  localization: {
    timeframe: "90d",
    place: "Meridian Labs office on Fifth Street",
  },
  triangulation: [
    "Complete the systems design portfolio review",
    "Pass the panel interview with two concrete demos",
    "Receive the written offer with compensation details",
  ],
  not_list: ["stay in current contractor loop", "accept lateral title without scope"],
  wrong_pulls: ["take the safe internal transfer"],
  features: [
    "calendar invite titled Senior Engineer from hiring manager",
    "badge scan logs morning entry at Meridian lobby",
    "paycheck deposit shows new salary band on the 15th",
  ],
  sync_actions: [
    { action: "Send thank-you email to panel within two hours" },
    { action: "Update LinkedIn headline before Monday", deadline: "2026-07-14" },
  ],
  session: {
    duration_min: 45,
    middle_start: 2,
    middle_count: 10,
    posture: "sitting",
    entrainment_mode: "isochronic",
    senses_emphasis: ["sight", "touch", "sound"],
  },
};

/** @deprecated Use intake45Min — kept as alias during v0.5 migration. */
export const intake40Min = intake45Min;

export const intake15Min: Intake = {
  ...intake45Min,
  session: {
    ...intake45Min.session,
    duration_min: 15,
    middle_start: 2,
    middle_count: 2,
  },
};

/** @deprecated Use intake15Min — kept as alias during v0.5 migration. */
export const intake20Min = intake15Min;

export const intakeInvalid = {
  goal_statement: "I want it",
  localization: {
    timeframe: "bad-date",
    place: "",
  },
  triangulation: ["short", "also short", "tiny"],
  not_list: ["only one"],
  wrong_pulls: ["a", "b", "c", "d"],
  features: ["vague feeling", "abstract energy"],
  sync_actions: [],
  session: {
    duration_min: 45,
    entrainment_mode: "isochronic",
    senses_emphasis: ["sight"],
  },
};
