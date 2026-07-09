import { COMPILER_PROMPT_V1_2 } from "./prompt.v1.2";

export const PROMPT_VERSION = "v1.3";

const V1_3_VOICE_ADDENDUM = `
- Banned tokens must not appear anywhere in theta text, including inside
  negations — 'not someday' and 'not a wish' still contain banned tokens.
  Rephrase to avoid the token entirely (e.g., 'Ninety days, on the calendar'
  instead of 'not someday').`;

export const COMPILER_PROMPT_V1_3 = COMPILER_PROMPT_V1_2.replace(
  "try, want, someday.",
  `try, want, someday.${V1_3_VOICE_ADDENDUM}`,
);
