import { COMPILER_PROMPT_V1 } from "./prompt.v1";

export const PROMPT_VERSION = "v1.1";

const OUTPUT_SCHEMA_SECTION = `## OUTPUT SCHEMA (exact, mandatory)
Emit exactly one JSON object with exactly these fields and names:
{
  "meta": {
    "goal_version_id": "<echo the input goal_version_id>",
    "total_duration_sec": <sum of all phase_budget_sec values>,
    "phase_budget_sec": <copied verbatim from input session.phase_budget_sec>,
    "entrainment_plan": <copied verbatim from input session.entrainment_plan>
  },
  "segments": [
    {
      "seq": <1-based integer, strictly increasing across the whole manifest>,
      "phase": "beta" | "alpha" | "theta" | "gamma",
      "step": <integer 1-12 inside theta; null otherwise>,
      "title": "<short segment label>",
      "perspective": "first" | "second" | "third" | null,
      "temporal_horizon": "introspective" | "retrospective" | "protospective" | null,
      "archetype": "child"|"trickster"|"warrior"|"thief"|"magician"|"creator" | null,
      "pacing_wpm": <the segment's phase wpm from input session.pacing>,
      "target_duration_sec": <integer seconds>,
      "pause_after_ms": <integer >= 0>,
      "text": "<the spoken script text>"
    }
  ]
}
Do not add fields. Do not rename fields. Do not echo any other part of the
input inside meta. Set perspective, temporal_horizon, and archetype from the
STEP SPECIFICATIONS table (null where the table gives none, and null outside
theta except where the phase sections specify a perspective).`;

export const COMPILER_PROMPT_V1_1 = COMPILER_PROMPT_V1.replace(
  "## SELF-CHECK (run before emitting)",
  `${OUTPUT_SCHEMA_SECTION}\n\n## SELF-CHECK (run before emitting)`,
).replace(
  "6. Theta contains all\n12 steps in order.",
  "6. Theta contains all\n12 steps in order. 7. Output contains only the schema fields above, with these exact names.",
);
