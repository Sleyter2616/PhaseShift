import { COMPILER_PROMPT_V1_1 } from "./prompt.v1.1";

export const PROMPT_VERSION = "v1.2";

const V1_2_OUTPUT_ADDENDA = `
- "Emit ONLY the JSON object, starting with { and ending with }. Never include reasoning, planning, commentary, or word counts."
- "Do not count words. Write naturally to approximately 85-95% of each segment's word budget; small overruns are tolerated and corrected downstream."
- "For silence longer than 3.0 seconds inside a segment, chain multiple <break time=\\"3.0s\\"/> tags back-to-back."`;

export const COMPILER_PROMPT_V1_2 = COMPILER_PROMPT_V1_1.replace(
  "STEP SPECIFICATIONS table (null where the table gives none, and null outside\ntheta except where the phase sections specify a perspective).",
  `STEP SPECIFICATIONS table (null where the table gives none, and null outside\ntheta except where the phase sections specify a perspective).${V1_2_OUTPUT_ADDENDA}`,
);
