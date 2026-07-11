/** Phase 4b.1 — wizard field explainers and input placeholders (§2.4). */

export interface WizardFieldCopy {
  heading: string;
  description: string;
  placeholder?: string;
}

export interface WizardStepCopy {
  heading: string;
  description: string;
  fields?: Record<string, WizardFieldCopy>;
}

export const WIZARD_STEP_COPY: Record<number, WizardStepCopy> = {
  1: {
    heading: "Goal statement",
    description:
      "The outcome you are locking in — stated in present tense, as already true, not as a wish. " +
      "The compiler quotes this verbatim during Surveillance and threads it through theta declarations in your own voice. " +
      'Example: "The senior engineer role at Meridian Labs is mine now."',
    fields: {
      goal_statement: {
        heading: "Goal statement",
        description: "",
        placeholder: "The senior engineer role at Meridian Labs is mine now.",
      },
    },
  },
  2: {
    heading: "Localization",
    description:
      "Anchors when and where the visualization happens — both fields are quoted verbatim in Localization (compiler step 3). " +
      "Timeframe sets the horizon; place is the concrete scene you step into. " +
      'Example: 90d and "Meridian Labs office on Fifth Street."',
    fields: {
      place: {
        heading: "Place",
        description: "",
        placeholder: "Meridian Labs office on Fifth Street",
      },
    },
  },
  3: {
    heading: "Prerequisites",
    description:
      "Three fixed points that must be true for the goal to be real — the compiler names all three verbatim in Triangulation (step 4) as anchors around the outcome. " +
      "List observable milestones, not feelings. " +
      'Example: "Complete the systems design portfolio review."',
    fields: {
      prerequisite1: {
        heading: "Prerequisite 1",
        description: "",
        placeholder: "Complete the systems design portfolio review",
      },
      prerequisite2: {
        heading: "Prerequisite 2",
        description: "",
        placeholder: "Pass the panel interview with two concrete demos",
      },
      prerequisite3: {
        heading: "Prerequisite 3",
        description: "",
        placeholder: "Receive the written offer with compensation details",
      },
    },
  },
  4: {
    heading: "Boundaries",
    description:
      "Name what does not count and what would pull you off course — the Warrior archetype handles both lists in the session.",
    fields: {
      not_list: {
        heading: "Not list (2–5)",
        description:
          "Near-miss outcomes that would NOT count as the goal — each gets named and dismissed in the session. " +
          "These are outcomes that look close but miss the target. " +
          'Example: "stay in current contractor loop."',
        placeholder: "stay in current contractor loop",
      },
      wrong_pulls: {
        heading: "Wrong-direction pulls (0–3)",
        description:
          "Tempting detours that lead away from the goal — these get firm boundary language. " +
          "The compiler treats each as a path to refuse, not a soft preference. " +
          'Example: "take the safe internal transfer."',
        placeholder: "take the safe internal transfer",
      },
    },
  },
  5: {
    heading: "Observable features",
    description:
      "Camera-visible signals the goal is approaching — you'll rehearse noticing each one during theta. " +
      "Each must be concrete enough to spot in daily life, not abstract feelings. " +
      'Example: "calendar invite titled Senior Engineer from hiring manager."',
    fields: {
      features: {
        heading: "Features (3–7)",
        description: "",
        placeholder: "calendar invite titled Senior Engineer from hiring manager",
      },
    },
  },
  6: {
    heading: "Sync actions",
    description:
      "Physical actions you will take in the waking world — the first one becomes your immediate post-session directive, so order matters. " +
      "The compiler quotes each action verbatim in theta. " +
      'Example: "Send thank-you email to panel within two hours."',
    fields: {
      action: {
        heading: "Action",
        description: "",
        placeholder: "Send thank-you email to panel within two hours",
      },
      deadline: {
        heading: "Deadline",
        description: "",
        placeholder: "Optional — e.g. 2026-07-14",
      },
    },
  },
  7: {
    heading: "Session settings",
    description:
      "This 40-minute preset sets phase budgets and entrainment tempo for the whole session. " +
      "Choose isochronic or binaural beats, which senses to emphasize in visualization, and stock or your cloned voice. " +
      "Example: isochronic, sight + touch, stock voice.",
  },
};
