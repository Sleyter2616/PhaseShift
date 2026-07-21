import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableMinutes,
  minutesCost,
  monthlyMinutesForTier,
  MINUTE_TIERS,
  planRefund,
  planRefundBreakdown,
  planSpend,
  SESSION_LENGTH_MINUTES,
  tierForStripePriceId,
  TOPUP_MINUTES,
  VOICE_MULTIPLIER,
} from "./minutes";

describe("minutes billing model", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_GUIDED", "price_guided_test");
    vi.stubEnv("STRIPE_PRICE_PRACT", "price_pract_test");
    vi.stubEnv("STRIPE_PRICE_TOPUP", "price_topup_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defines tier allotments and top-up pack", () => {
    expect(MINUTE_TIERS.guided).toMatchObject({ priceUsd: 29, monthlyMinutes: 240 });
    expect(MINUTE_TIERS.practitioner).toMatchObject({ priceUsd: 49, monthlyMinutes: 640 });
    expect(monthlyMinutesForTier("guided")).toBe(240);
    expect(monthlyMinutesForTier("practitioner")).toBe(640);
    expect(TOPUP_MINUTES).toEqual({ priceUsd: 8, minutes: 80 });
  });

  it("maps Stripe price IDs to minute tiers", () => {
    expect(tierForStripePriceId("price_guided_test")).toBe("guided");
    expect(tierForStripePriceId("price_pract_test")).toBe("practitioner");
    expect(tierForStripePriceId("price_unknown")).toBeNull();
  });

  it("computes minutesCost with stock=1 and own_voice=2", () => {
    expect(VOICE_MULTIPLIER).toEqual({ stock: 1, own_voice: 2 });
    expect(minutesCost(SESSION_LENGTH_MINUTES, false)).toBe(40);
    expect(minutesCost(SESSION_LENGTH_MINUTES, true)).toBe(80);
    expect(minutesCost(20, false)).toBe(20);
    expect(minutesCost(20, true)).toBe(40);
  });

  it("rejects non-positive length for minutesCost", () => {
    expect(() => minutesCost(0, false)).toThrow("invalid_minutes_amount");
    expect(() => minutesCost(-1, true)).toThrow("invalid_minutes_amount");
  });
});

describe("planSpend (subscription-first)", () => {
  it("spends subscription only when enough", () => {
    const result = planSpend({ subscription: 120, topup: 40 }, 80);
    expect(result).toEqual({
      ok: true,
      breakdown: { subscriptionSpent: 80, topupSpent: 0 },
      next: { subscription: 40, topup: 40 },
    });
  });

  it("spills into topup after subscription is exhausted", () => {
    const result = planSpend({ subscription: 40, topup: 80 }, 80);
    expect(result).toEqual({
      ok: true,
      breakdown: { subscriptionSpent: 40, topupSpent: 40 },
      next: { subscription: 0, topup: 40 },
    });
  });

  it("uses only topup when subscription is empty", () => {
    const result = planSpend({ subscription: 0, topup: 100 }, 80);
    expect(result).toEqual({
      ok: true,
      breakdown: { subscriptionSpent: 0, topupSpent: 80 },
      next: { subscription: 0, topup: 20 },
    });
  });

  it("detects insufficient before mutating", () => {
    const pools = { subscription: 40, topup: 20 };
    const result = planSpend(pools, 80);
    expect(result).toEqual({ ok: false, error: "insufficient_minutes" });
    expect(pools).toEqual({ subscription: 40, topup: 20 });
    expect(availableMinutes(pools)).toBe(60);
  });

  it("matches concurrency budget: 120+40 supports exactly two 80 spends", () => {
    let pools = { subscription: 120, topup: 40 };
    const first = planSpend(pools, 80);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    pools = first.next;
    const second = planSpend(pools, 80);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    pools = second.next;
    expect(pools).toEqual({ subscription: 0, topup: 0 });
    expect(planSpend(pools, 80)).toEqual({ ok: false, error: "insufficient_minutes" });
  });
});

describe("planRefund", () => {
  it("refunds into the specified pool", () => {
    expect(planRefund({ subscription: 0, topup: 0 }, 40, "subscription")).toEqual({
      subscription: 40,
      topup: 0,
    });
    expect(planRefund({ subscription: 10, topup: 5 }, 20, "topup")).toEqual({
      subscription: 10,
      topup: 25,
    });
  });

  it("refunds exact spend breakdown (subscription then topup)", () => {
    const afterSpend = { subscription: 0, topup: 20 };
    const restored = planRefundBreakdown(afterSpend, {
      subscriptionSpent: 40,
      topupSpent: 40,
    });
    expect(restored).toEqual({ subscription: 40, topup: 60 });
  });
});
