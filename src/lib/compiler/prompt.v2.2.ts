import { COMPILER_PROMPT_V2_1 } from "./prompt.v2.1";

export const PROMPT_VERSION = "v2.2";

/**
 * Compiler prompt v2.2 — length-ladder depth calibration on immutable v2.1:
 * - Per-step target_sec / target_words from skeleton
 * - Longer sessions deepen sensory density (not more steps / filler)
 * - Extended gamma for action integration at depth lengths
 */
export const COMPILER_PROMPT_V2_2 = COMPILER_PROMPT_V2_1.replace(
  "You are the Phase Locking Script Compiler (v2.1).",
  "You are the Phase Locking Script Compiler (v2.2).",
)
  .replace(
    `  skeleton: {
    length_min, steps, posture,
    phase_budget: { beta_sec, alpha_sec, theta_sec, gamma_sec },
    theta_steps: [{ step, target_sec }],
    counted_sequences: { alpha_breath, alpha_countdown, gamma_energizing, gamma_countup }
  } }`,
    `  skeleton: {
    length_min, steps, posture,
    phase_budget: { beta_sec, alpha_sec, theta_sec, gamma_sec },
    depth: { density_factor, reflective_pauses },
    theta_steps: [{ step, name, target_sec, target_words }],
    counted_sequences: { alpha_breath, alpha_countdown, gamma_energizing, gamma_countup }
  } }`,
  )
  .replace(
    `4. Each theta step's total target_duration_sec across its segments must equal the
   matching skeleton.theta_steps[].target_sec for that step.
5. Counted sequences (breaths, countdowns, energizing breaths, count-ups) are`,
    `4. Each theta step's total target_duration_sec across its segments must equal the
   matching skeleton.theta_steps[].target_sec for that step. Write enough spoken
   text to approach that step's target_words (≈ pacing.theta_wpm × target_sec / 60).
5. Counted sequences (breaths, countdowns, energizing breaths, count-ups) are`,
  )
  .replace(
    `## STRUCTURAL RULES
1. Word budget per segment = pacing_wpm * target_duration_sec / 60. Treat this as
   a ceiling. Aim for 85-95% of the word budget so post-synthesis silence can stretch.`,
    `## DEPTH BY LENGTH (skeleton.depth)
- density_factor = 1.0 at ≤30 min: STANDARD density. Fill each step's target_sec /
  target_words with clear, complete content — do NOT pad with filler or silence.
- density_factor > 1 (e.g. ~1.5 at 45 min): same steps, DEEPER. Elaborate each
  theta step with greater SENSORY density — texture, sound, temperature, smell,
  weight, spatial precision. Elaboration, not filler, not extra steps.
- When density_factor > 1, prefer two segments per theta step with a reflective
  pause_after_ms ≈ skeleton.depth.reflective_pauses.within_step_ms on the first
  segment of the step (dwelling silence). Between steps, use
  reflective_pauses.between_step_ms on the last segment of each step except Closure.
- Do not add steps. Do not invent phase announcements. Depth is richer sensory
  content meeting the larger per-step word targets.

## STRUCTURAL RULES
1. Word budget per segment = pacing_wpm * target_duration_sec / 60. Treat this as
   a ceiling. Aim for 85-95% of the word budget (and of each theta step's
   target_words). Meet the budget with substance — never pad.`,
  )
  .replace(
    `## GAMMA (exit)
Do NOT write energizing-breath rounds, breath narration, or count-up numbers —
the server inserts gamma_energizing and gamma_countup micro-segments. Your gamma
segments give high-energy body cues (no breath/rhythm language) and direct the
listener into sync_actions[0] as the immediate next physical act after the
session. Imperative, tempered by posture.`,
    `## GAMMA (exit)
Do NOT write energizing-breath rounds, breath narration, or count-up numbers —
the server inserts gamma_energizing and gamma_countup micro-segments. Your gamma
segments give high-energy body cues (no breath/rhythm language) and direct the
listener into sync_actions[0] as the immediate next physical act after the
session. Imperative, tempered by posture.
When skeleton.depth.density_factor > 1 (longer sessions), spend the larger gamma
budget on ACTION INTEGRATION: elaborate each sync_action with when/where/body
detail and rehearse the first physical post-session act until it feels inevitable.
Do not fill gamma with abstract pep talk — concrete next moves only.`,
  )
  .replace(
    `4. Each theta step's duration sum equals skeleton.theta_steps target_sec.
5. No counted-sequence narration, no breath/rhythm/cadence language anywhere`,
    `4. Each theta step's duration sum equals skeleton.theta_steps target_sec;
   spoken words approach that step's target_words (85-95%).
5. No counted-sequence narration, no breath/rhythm/cadence language anywhere`,
  );
