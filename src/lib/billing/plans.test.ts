import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  creditsPerGeneration,
  monthlyCreditsForTier,
  SUBSCRIPTION_TIERS,
  tierForStripePriceId,
  TOP_UP,
} from "./plans";

describe("billing plans", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_GUIDED", "price_guided_test");
    vi.stubEnv("STRIPE_PRICE_PRACT", "price_pract_test");
    vi.stubEnv("STRIPE_PRICE_TOPUP", "price_topup_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defines §5 top-up and tier allotments", () => {
    expect(TOP_UP).toEqual({ priceUsd: 6, credits: 1 });
    expect(SUBSCRIPTION_TIERS.guided).toMatchObject({ priceUsd: 29, monthlyCredits: 3 });
    expect(SUBSCRIPTION_TIERS.practitioner).toMatchObject({ priceUsd: 49, monthlyCredits: 10 });
    expect(monthlyCreditsForTier("guided")).toBe(3);
    expect(monthlyCreditsForTier("practitioner")).toBe(10);
  });

  it("maps Stripe price IDs from env", () => {
    expect(tierForStripePriceId("price_guided_test")).toBe("guided");
    expect(tierForStripePriceId("price_pract_test")).toBe("practitioner");
    expect(tierForStripePriceId("price_unknown")).toBeNull();
  });

  it("charges 1 credit for Flash and 2 for v2/clone models", () => {
    expect(creditsPerGeneration("eleven_flash_v2_5")).toBe(1);
    expect(creditsPerGeneration("eleven_multilingual_v2")).toBe(2);
    expect(creditsPerGeneration("eleven_custom_clone_multilingual")).toBe(2);
  });
});
