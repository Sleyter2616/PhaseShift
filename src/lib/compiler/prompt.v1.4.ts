import { COMPILER_PROMPT_V1_3 } from "./prompt.v1.3";

export const PROMPT_VERSION = "v1.4";

const V1_4_CONTENT_ADDENDUM = `

## CONTENT RULES (mandatory)
(a) Write all numbers as words in segment text — never use digit characters for quantities, ordinals, or counts.
(b) Introduce every countdown before it begins — never start counting without a clear lead-in sentence.
(c) At each phase boundary (beta→alpha, alpha→theta, theta→gamma), include one explicit transition sentence naming the shift.
(d) Never read dates as digit sequences; input dates are already in natural speech — quote them verbatim.
(e) All numerals, currency, and dates in output must be written as spoken words, never symbols or digits.`;

export const COMPILER_PROMPT_V1_4 = `${COMPILER_PROMPT_V1_3}${V1_4_CONTENT_ADDENDUM}`;
