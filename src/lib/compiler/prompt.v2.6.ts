import { COMPILER_PROMPT_V2_5 } from "./prompt.v2.5";

export const PROMPT_VERSION = "v2.6";

/**
 * Compiler prompt v2.6 — unhurried opening on immutable v2.5:
 * beta + early alpha (before progressive body scan) stay sparse and patient.
 */
export const COMPILER_PROMPT_V2_6 = COMPILER_PROMPT_V2_5.replace(
  "You are the Phase Locking Script Compiler (v2.5).",
  "You are the Phase Locking Script Compiler (v2.6).",
).replace(
  `## STRUCTURAL RULES
1. Word budget per segment ≈ pacing_wpm * target_duration_sec / 60. For theta,`,
  `## OPENING PACE (beta + early alpha)
The first minutes must feel calm and patient — the listener is still settling.
In beta and early alpha (before / at the start of the progressive body scan):
use short, unhurried sentences, leave space, avoid brisk lists or dense
instructions. Do not rush the entry; denser body-scan detail comes after they
have slowed down.

## STRUCTURAL RULES
1. Word budget per segment ≈ pacing_wpm * target_duration_sec / 60. For theta,`,
);
