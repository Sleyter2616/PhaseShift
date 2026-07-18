import {
  CREDITS_PER_V2_GENERATION,
  GENERATION_COST_CREDITS,
  TOPUP_PRICE_PER_CREDIT_USD,
} from "../costs";
import { DEFAULT_CLONE_ELEVENLABS_MODEL_ID, DEFAULT_ELEVENLABS_MODEL_ID } from "../pipeline/synthesis-identity";

/** §5 — single credit top-up (Flash generation up to 30k chars). */
export const TOP_UP = {
  priceUsd: TOPUP_PRICE_PER_CREDIT_USD,
  credits: 1,
} as const;

export type SubscriptionTierId = "guided" | "practitioner";

/** §5 + D23 — Guided uses v2 clone default, so monthly allotment is 3 credits. */
export const SUBSCRIPTION_TIERS: Record<
  SubscriptionTierId,
  { priceUsd: number; monthlyCredits: number; label: string }
> = {
  guided: { priceUsd: 29, monthlyCredits: 3, label: "Guided" },
  practitioner: { priceUsd: 49, monthlyCredits: 10, label: "Practitioner" },
};

export interface StripePriceIds {
  topup: string | undefined;
  guided: string | undefined;
  practitioner: string | undefined;
}

/** Paste Stripe Dashboard Price IDs into env after creating Products/Prices. */
export function stripePriceIdsFromEnv(): StripePriceIds {
  return {
    topup: process.env.STRIPE_PRICE_TOPUP,
    guided: process.env.STRIPE_PRICE_GUIDED,
    practitioner: process.env.STRIPE_PRICE_PRACT,
  };
}

export function tierForStripePriceId(priceId: string): SubscriptionTierId | null {
  const ids = stripePriceIdsFromEnv();
  if (ids.guided && priceId === ids.guided) return "guided";
  if (ids.practitioner && priceId === ids.practitioner) return "practitioner";
  return null;
}

export function stripePriceIdForTier(tier: SubscriptionTierId): string {
  const ids = stripePriceIdsFromEnv();
  const priceId = tier === "guided" ? ids.guided : ids.practitioner;
  if (!priceId) {
    throw new Error(`missing Stripe price env for tier ${tier}`);
  }
  return priceId;
}

export function monthlyCreditsForTier(tier: SubscriptionTierId): number {
  return SUBSCRIPTION_TIERS[tier].monthlyCredits;
}

/** Flash stock = 1 credit; multilingual v2 / clone default = 2 credits. */
export function creditsPerGeneration(modelId: string): number {
  if (
    modelId === DEFAULT_CLONE_ELEVENLABS_MODEL_ID ||
    modelId === "eleven_multilingual_v2" ||
    modelId.includes("multilingual")
  ) {
    return CREDITS_PER_V2_GENERATION;
  }
  if (modelId === DEFAULT_ELEVENLABS_MODEL_ID || modelId.includes("flash")) {
    return GENERATION_COST_CREDITS;
  }
  return CREDITS_PER_V2_GENERATION;
}

export function stripeTopupPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_TOPUP;
  if (!priceId) throw new Error("STRIPE_PRICE_TOPUP is not set");
  return priceId;
}

export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
