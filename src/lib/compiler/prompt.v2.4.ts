import { COMPILER_PROMPT_V2_3 } from "./prompt.v2.3";

export const PROMPT_VERSION = "v2.4";

/**
 * Compiler prompt v2.4 — word-budget minimums on immutable v2.3:
 * - Per-step target_words are MINIMUMS (not soft ceilings / 85-95% aims)
 * - Underfilled theta fails the length gate and triggers expand recompiles
 */
export const COMPILER_PROMPT_V2_4 = COMPILER_PROMPT_V2_3.replace(
  "You are the Phase Locking Script Compiler (v2.3).",
  "You are the Phase Locking Script Compiler (v2.4).",
)
  .replace(
    `4. Each theta step's total target_duration_sec across its segments must equal the
   matching skeleton.theta_steps[].target_sec for that step. Write enough spoken
   text to approach that step's target_words (≈ pacing.theta_wpm × target_sec / 60).`,
    `4. Each theta step's total target_duration_sec across its segments must equal the
   matching skeleton.theta_steps[].target_sec for that step. Each theta step MUST
   contain at least skeleton.theta_steps[].target_words speakable words (MINIMUM,
   not a soft aim). target_words ≈ pacing.theta_wpm × target_sec / 60 — self-check
   against the per-step numbers in your input. Sessions that fall short fail
   validation / length gate.`,
  )
  .replace(
    `## DEPTH BY LENGTH (skeleton.depth)
- density_factor = 1.0 at ≤30 min: STANDARD density. Fill each step's target_sec /
  target_words with clear, complete content — do NOT pad with filler or silence.
- density_factor > 1 (e.g. ~1.5 at 45 min): same steps, DEEPER. Elaborate each
  theta step with greater SENSORY density — texture, sound, temperature, smell,
  weight, spatial precision. Elaboration, not filler, not extra steps.`,
    `## DEPTH BY LENGTH (skeleton.depth)
- density_factor = 1.0 at ≤30 min: STANDARD density. Meet each step's target_sec /
  target_words MINIMUM with clear, complete content — do NOT pad with filler or
  silence, and do NOT stop early at ~85% of the word target.
- density_factor > 1 (e.g. ~1.5 at 45 min): same steps, DEEPER. Elaborate each
  theta step with greater SENSORY density — texture, sound, temperature, smell,
  weight, spatial precision — until you meet the larger target_words minimum.
  Elaboration, not filler, not extra steps.`,
  )
  .replace(
    `## STRUCTURAL RULES
1. Word budget per segment = pacing_wpm * target_duration_sec / 60. Treat this as
   a ceiling. Aim for 85-95% of the word budget (and of each theta step's
   target_words). Meet the budget with substance — never pad.`,
    `## STRUCTURAL RULES
1. Word budget per segment ≈ pacing_wpm * target_duration_sec / 60. For theta,
   skeleton.theta_steps[].target_words is a HARD MINIMUM for that step's total
   speakable words across its segments — meet or slightly exceed it with
   substance. Never treat ~85-90% as "good enough." Never pad with filler.`,
  )
  .replace(
    `4. Each theta step's duration sum equals skeleton.theta_steps target_sec;
   spoken words approach that step's target_words (85-95%).`,
    `4. Each theta step's duration sum equals skeleton.theta_steps target_sec;
   spoken words MUST be ≥ that step's target_words (minimum). Self-check the
   counts in skeleton.theta_steps before emitting.`,
  )
  .replace(
    `7. Per-segment word counts do not exceed the calculated budget (usually 85-95%).
8. All intake strings for PRESENT steps appear verbatim. No banned tokens.`,
    `7. Theta step word totals meet or exceed each step's target_words minimum
   (slight overage OK; chronic underwrite is a failure).
8. All intake strings for PRESENT steps appear verbatim. No banned tokens.`,
  );
