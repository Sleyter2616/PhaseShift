import type { TtsProviderId } from "./tts/provider";
import {
  LENGTHS,
  buildSessionSkeleton,
  type SessionLengthMin,
} from "./compiler/skeleton";

/** §2.3 — Effective pacing (words per minute, silence included) */
export const PACING_WPM = {
  beta: 130,
  alpha: 90,
  theta: 105,
  gamma: 150,
} as const;

export type DurationPreset = SessionLengthMin;

export { LENGTHS };

/** Phase budgets (seconds) derived from the server-owned skeleton (full step set). */
export const PHASE_BUDGET_SEC = Object.fromEntries(
  LENGTHS.map((length) => {
    const { phase_budget } = buildSessionSkeleton({ length_min: length });
    return [
      length,
      {
        beta: phase_budget.beta_sec,
        alpha: phase_budget.alpha_sec,
        theta: phase_budget.theta_sec,
        gamma: phase_budget.gamma_sec,
      },
    ];
  }),
) as Record<SessionLengthMin, { beta: number; alpha: number; theta: number; gamma: number }>;

/** §2.3 — ~27,000 billable characters per 40-min full generation (legacy reference) */
export const BILLABLE_CHARS_40MIN = 27_000;

/** §5 — 1 credit = one Flash generation (blueprint §5 top-up) */
export const GENERATION_COST_CREDITS = 1;

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

/** §5 — Indicative only; re-verify at Phase 2 implementation. */
export const PROVIDER_PRICING_USD_PER_1M_CHARS: Record<
  TtsProviderId,
  { low: number; high: number; verifiedAt: string }
> = {
  elevenlabs: { low: 50, high: 120, verifiedAt: "2026-07" },
  openai: { low: 15, high: 15, verifiedAt: "2026-07" },
  google: { low: 4, high: 16, verifiedAt: "2026-07" },
  amazon: { low: 4, high: 16, verifiedAt: "2026-07" },
  inworld: { low: 5, high: 25, verifiedAt: "2026-07" },
  minimax: { low: 60, high: 100, verifiedAt: "2026-07" },
  selfhost: { low: 1, high: 1, verifiedAt: "2026-07" },
};
