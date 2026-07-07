/** §2.3 — Effective pacing (words per minute, silence included) */
export const PACING_WPM = {
  beta: 130,
  alpha: 90,
  theta: 105,
  gamma: 150,
} as const;

/** §2.3 — Phase budgets by preset (seconds) */
export const PHASE_BUDGET_SEC = {
  20: { beta: 60, alpha: 240, theta: 780, gamma: 120 },
  30: { beta: 90, alpha: 360, theta: 1140, gamma: 210 },
  40: { beta: 120, alpha: 480, theta: 1500, gamma: 300 },
  60: { beta: 180, alpha: 720, theta: 2340, gamma: 360 },
} as const;

export type DurationPreset = keyof typeof PHASE_BUDGET_SEC;

/** §2.3 — ~27,000 billable characters per 40-min full generation */
export const BILLABLE_CHARS_40MIN = 27_000;

/** §5 — Credits per full 40-minute generation by model tier */
export const CREDITS_FULL_GENERATION = {
  flash: 13_500,
  multilingualV2: 27_000,
} as const;

/** §5 — Re-triangulation regen (~40% of chars) */
export const CREDITS_REGEN = {
  flash: 5_400,
  multilingualV2: 10_800,
} as const;

/** §5 — 1 credit = one Flash generation up to 30k chars; v2 = 2 credits */
export const CREDIT_CHAR_CAP_FLASH = 30_000;
export const CREDITS_PER_V2_GENERATION = 2;

/** §5 — Subscription tier included credits per month */
export const TIER_MONTHLY_CREDITS = {
  guidedFlash: 4,
  guidedV2: 3,
  practitioner: 10,
} as const;

/** §5 — Re-triangulation partial credit when changed chars under threshold */
export const REGEN_PARTIAL_CREDIT = 0.5;
export const REGEN_PARTIAL_CHAR_THRESHOLD = 12_000;

/** §5 — Top-up price reference */
export const TOPUP_PRICE_PER_CREDIT_USD = 6;
