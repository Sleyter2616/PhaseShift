/**
 * Phase 9a — minutes billing model (TS mirror of SQL).
 * Credits in plans.ts remain until 9b swaps the pipeline over.
 */

export const SESSION_LENGTH_MINUTES = 40;

/** stock = 1× length; own_voice = 2× length. */
export const VOICE_MULTIPLIER = {
  stock: 1,
  own_voice: 2,
} as const;

export type MinutesTierId = "guided" | "practitioner";

export const MINUTE_TIERS: Record<
  MinutesTierId,
  { priceUsd: number; monthlyMinutes: number; label: string }
> = {
  guided: { priceUsd: 29, monthlyMinutes: 240, label: "Guided" },
  practitioner: { priceUsd: 49, monthlyMinutes: 640, label: "Practitioner" },
};

/** Single top-up pack. */
export const TOPUP_MINUTES = {
  priceUsd: 8,
  minutes: 80,
} as const;

export type MinutePool = "subscription" | "topup";

export type MinutePools = {
  subscription: number;
  topup: number;
};

export type SpendBreakdown = {
  subscriptionSpent: number;
  topupSpent: number;
};

export type SpendPlan =
  | { ok: true; breakdown: SpendBreakdown; next: MinutePools }
  | { ok: false; error: "insufficient_minutes" };

/** Pure helper: length_minutes × (2 if own voice else 1). */
export function minutesCost(lengthMin: number, isOwnVoice: boolean): number {
  if (!Number.isInteger(lengthMin) || lengthMin <= 0) {
    throw new Error("invalid_minutes_amount");
  }
  return lengthMin * (isOwnVoice ? VOICE_MULTIPLIER.own_voice : VOICE_MULTIPLIER.stock);
}

/** Offline mirror of spend_minutes: subscription first, then topup; check before mutate. */
export function planSpend(pools: MinutePools, minutes: number): SpendPlan {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error("invalid_minutes_amount");
  }
  if (pools.subscription < 0 || pools.topup < 0) {
    throw new Error("invalid_pools");
  }
  if (pools.subscription + pools.topup < minutes) {
    return { ok: false, error: "insufficient_minutes" };
  }
  const subscriptionSpent = Math.min(pools.subscription, minutes);
  const topupSpent = minutes - subscriptionSpent;
  return {
    ok: true,
    breakdown: { subscriptionSpent, topupSpent },
    next: {
      subscription: pools.subscription - subscriptionSpent,
      topup: pools.topup - topupSpent,
    },
  };
}

/** Offline mirror of refund_minutes into a single pool. */
export function planRefund(
  pools: MinutePools,
  minutes: number,
  pool: MinutePool,
): MinutePools {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error("invalid_minutes_amount");
  }
  if (pool === "subscription") {
    return { subscription: pools.subscription + minutes, topup: pools.topup };
  }
  return { subscription: pools.subscription, topup: pools.topup + minutes };
}

/** Refund using the spend breakdown (exact reverse of a successful spend). */
export function planRefundBreakdown(
  pools: MinutePools,
  breakdown: SpendBreakdown,
): MinutePools {
  let next = pools;
  if (breakdown.subscriptionSpent > 0) {
    next = planRefund(next, breakdown.subscriptionSpent, "subscription");
  }
  if (breakdown.topupSpent > 0) {
    next = planRefund(next, breakdown.topupSpent, "topup");
  }
  return next;
}

export function monthlyMinutesForTier(tier: MinutesTierId): number {
  return MINUTE_TIERS[tier].monthlyMinutes;
}
