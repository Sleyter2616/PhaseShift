import { COMPILER_PROMPT_V2_4 } from "./prompt.v2.4";

export const PROMPT_VERSION = "v2.5";

/**
 * Compiler prompt v2.5 — person-adjusted intake embedding on immutable v2.4:
 * - Verbatim nouns/specifics; adjust person when embedding in second-person guidance
 * - First-person goal/sync declarations stay verbatim
 */
export const COMPILER_PROMPT_V2_5 = COMPILER_PROMPT_V2_4.replace(
  "You are the Phase Locking Script Compiler (v2.4).",
  "You are the Phase Locking Script Compiler (v2.5).",
)
  .replace(
    `3. Every intake string (goal_statement, both localization fields, all three
   triangulation items, every not_list item, every feature, every sync_action)
   appears verbatim at least once, in its designated step (when that step is present
   in skeleton.steps). If a step is absent from skeleton.steps, skip its verbatim
   requirements.`,
    `3. Intake embedding — PERSON-AWARE VERBATIM:
   - Preserve the user's NOUNS and specifics exactly (place names, role titles,
     feature wording, deadlines). Do not invent or soften them.
   - When the surrounding narration addresses the listener as "you" (beta/alpha/
     gamma, and second-person theta guidance), person-adjust first-person forms
     from the user's input: my→your, I→you, mine→yours, myself→yourself.
     Example: place "my Hamilton Heights apartment" becomes
     "you are inside your Hamilton Heights apartment" — not "my."
   - When the line is spoken in FIRST person (goal declaration spoken aloud,
     theta closing "I/my" declarations, sync-action "I" statements), keep the
     intake string's person verbatim ("the role is mine" stays "mine").
   - Never drop a required intake string; only adjust person so it is grammatical
     when spoken TO the listener. If a step is absent from skeleton.steps, skip
     its intake requirements.`,
  )
  .replace(
    `8. All intake strings for PRESENT steps appear verbatim. No banned tokens.`,
    `8. All intake strings for PRESENT steps appear (nouns/specifics exact);
   person-adjust possessives/pronouns when embedded in second-person guidance.
   No banned tokens.`,
  );
