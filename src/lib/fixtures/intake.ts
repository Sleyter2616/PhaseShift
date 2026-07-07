import type { Intake } from "../contracts/intake";

/** Golden fixtures intentionally contain no `<break>` SSML tags (intake layer only). */

export const intake40Min: Intake = {
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
    duration_min: 40,
    entrainment_mode: "isochronic",
    senses_emphasis: ["sight", "touch", "sound"],
  },
};

export const intake20Min: Intake = {
  ...intake40Min,
  session: {
    ...intake40Min.session,
    duration_min: 20,
  },
};

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
    duration_min: 40,
    entrainment_mode: "isochronic",
    senses_emphasis: ["sight"],
  },
};
