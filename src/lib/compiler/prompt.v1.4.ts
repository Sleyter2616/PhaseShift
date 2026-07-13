import { COMPILER_PROMPT_V1_3 } from "./prompt.v1.3";

export const PROMPT_VERSION = "v1.4";

const V1_4_CONTENT_ADDENDUM = `

## CONTENT RULES (mandatory)
- Write ALL numerals, currency, and dates as spoken words, never symbols or digits (write "one million dollars", not "$1M"; "May seventh", not "2027-05-07").
- Introduce every countdown before it begins with one framing line (e.g., "Counting down from ten now, each number takes you one level deeper").
- At each phase boundary (beta→alpha, alpha→theta, theta→gamma), include one explicit transition sentence naming the shift.
- Never read dates as digit sequences; input dates are already in natural speech — quote them verbatim.

## ALPHA guidance (mandatory)
- Do NOT repeat a full ten-to-one countdown in every alpha segment.
- At most one full countdown across alpha, placed in the final alpha segment only.
- Earlier alpha segments deepen via breath and body cues only — no numeric countdown sequences.`;

export const COMPILER_PROMPT_V1_4 = `${COMPILER_PROMPT_V1_3}${V1_4_CONTENT_ADDENDUM}`;
