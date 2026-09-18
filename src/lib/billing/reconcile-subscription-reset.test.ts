import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { ServiceClient } from "../db/service-client";
import {
  displaySubscriptionResetAt,
  isSubscriptionResetStale,
  listStaleSubscriptionResetUserIds,
  reconcileStaleSubscriptionReset,
} from "./reconcile-subscription-reset";

vi.mock("./webhook", async () => {
  const actual = await vi.importActual<typeof import("./webhook")>("./webhook");
  return {
    ...actual,
    grantSubscriptionMinutesForUser: vi.fn(async () => undefined),
    syncSubscriptionProfile: vi.fn(async () => "guided"),
  };
});

import { grantSubscriptionMinutesForUser, syncSubscriptionProfile } from "./webhook";

const grantMock = vi.mocked(grantSubscriptionMinutesForUser);
const syncMock = vi.mocked(syncSubscriptionProfile);

afterEach(() => {
  grantMock.mockClear();
  syncMock.mockClear();
  vi.unstubAllEnvs();
});

const PAST = "2026-08-01T00:00:00.000Z";
const FUTURE_UNIX = Math.floor(Date.parse("2026-10-01T00:00:00.000Z") / 1000);
const NOW = new Date("2026-09-18T12:00:00.000Z");

function activeSubscription(overrides?: Partial<Stripe.Subscription>): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    items: {
      data: [
        {
          current_period_end: FUTURE_UNIX,
          price: { id: "price_guided_test" },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function mockSupabase(profile: {
  stripe_customer_id: string | null;
  subscription_status?: string | null;
  subscription_minutes_reset_at: string | null;
  id?: string;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const staleIds: string[] = [];
  const supabase = {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select(columns: string) {
          if (columns === "id") {
            return {
              not: () => ({
                lt: () => ({
                  limit: async () => ({
                    data: staleIds.map((id) => ({ id })),
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  stripe_customer_id: profile.stripe_customer_id,
                  subscription_status: profile.subscription_status ?? "active",
                  subscription_minutes_reset_at: profile.subscription_minutes_reset_at,
                },
                error: null,
              }),
            }),
          };
        },
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };
  return { supabase: supabase as unknown as ServiceClient, updates, staleIds };
}

function mockStripe(subscriptions: Stripe.Subscription[]) {
  return {
    subscriptions: {
      list: vi.fn(async (params: { status?: string }) => {
        if (params.status === "canceled") {
          return { data: subscriptions.filter((s) => s.status === "canceled") };
        }
        return { data: subscriptions.filter((s) => s.status !== "canceled") };
      }),
    },
  };
}

describe("isSubscriptionResetStale / display", () => {
  it("treats a past reset_at as stale and hides it from UI", () => {
    expect(isSubscriptionResetStale(PAST, NOW)).toBe(true);
    expect(displaySubscriptionResetAt(PAST, NOW)).toBeNull();
    expect(isSubscriptionResetStale("2026-10-01T00:00:00.000Z", NOW)).toBe(false);
    expect(displaySubscriptionResetAt("2026-10-01T00:00:00.000Z", NOW)).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(isSubscriptionResetStale(null, NOW)).toBe(false);
    expect(displaySubscriptionResetAt(null, NOW)).toBeNull();
  });
});

describe("reconcileStaleSubscriptionReset", () => {
  it("no-ops when reset_at is still in the future", async () => {
    const { supabase, updates } = mockSupabase({
      stripe_customer_id: "cus_1",
      subscription_minutes_reset_at: "2026-10-01T00:00:00.000Z",
    });
    const result = await reconcileStaleSubscriptionReset({
      userId: "user-1",
      supabase,
      stripe: mockStripe([activeSubscription()]) as never,
      now: NOW,
    });
    expect(result).toEqual({ action: "current" });
    expect(grantMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("grants via the same RPC as invoice.paid when Stripe status is active", async () => {
    vi.stubEnv("STRIPE_PRICE_GUIDED", "price_guided_test");
    const { supabase, updates } = mockSupabase({
      stripe_customer_id: "cus_1",
      subscription_status: "active",
      subscription_minutes_reset_at: PAST,
    });
    const sub = activeSubscription();
    const result = await reconcileStaleSubscriptionReset({
      userId: "user-1",
      supabase,
      stripe: mockStripe([sub]) as never,
      now: NOW,
    });
    expect(result).toEqual({
      action: "granted",
      periodEnd: new Date(FUTURE_UNIX * 1000).toISOString(),
    });
    expect(grantMock).toHaveBeenCalledWith(
      supabase,
      "user-1",
      240,
      new Date(FUTURE_UNIX * 1000).toISOString(),
    );
    expect(updates[0]).toMatchObject({
      subscription_status: "active",
      subscription_tier: "guided",
    });
    vi.unstubAllEnvs();
  });

  it("does not grant minutes on a canceled / lapsed subscription", async () => {
    const { supabase, updates } = mockSupabase({
      stripe_customer_id: "cus_1",
      subscription_status: "active",
      subscription_minutes_reset_at: PAST,
    });
    const canceled = activeSubscription({ status: "canceled" });
    const result = await reconcileStaleSubscriptionReset({
      userId: "user-1",
      supabase,
      stripe: mockStripe([canceled]) as never,
      now: NOW,
    });
    expect(result).toEqual({ action: "skipped_unpaid" });
    expect(grantMock).not.toHaveBeenCalled();
    expect(syncMock).toHaveBeenCalled();
    expect(updates.some((u) => u.subscription_minutes_reset_at === null)).toBe(true);
  });

  it("does not grant trialing subscriptions (not paid)", async () => {
    const { supabase } = mockSupabase({
      stripe_customer_id: "cus_1",
      subscription_minutes_reset_at: PAST,
    });
    const trialing = activeSubscription({ status: "trialing" });
    const result = await reconcileStaleSubscriptionReset({
      userId: "user-1",
      supabase,
      stripe: mockStripe([trialing]) as never,
      now: NOW,
    });
    expect(result).toEqual({ action: "skipped_unpaid" });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("does not grant past_due (unpaid) subscriptions", async () => {
    const { supabase, updates } = mockSupabase({
      stripe_customer_id: "cus_1",
      subscription_minutes_reset_at: PAST,
    });
    const pastDue = activeSubscription({ status: "past_due" });
    const result = await reconcileStaleSubscriptionReset({
      userId: "user-1",
      supabase,
      stripe: mockStripe([pastDue]) as never,
      now: NOW,
    });
    expect(result).toEqual({ action: "skipped_unpaid" });
    expect(grantMock).not.toHaveBeenCalled();
    expect(updates.some((u) => u.subscription_minutes_reset_at === null)).toBe(true);
  });

  it("clears a past date when there is no Stripe customer (cannot verify payment)", async () => {
    const { supabase, updates } = mockSupabase({
      stripe_customer_id: null,
      subscription_minutes_reset_at: PAST,
    });
    const result = await reconcileStaleSubscriptionReset({
      userId: "user-1",
      supabase,
      stripe: mockStripe([]) as never,
      now: NOW,
    });
    expect(result).toEqual({ action: "cleared_stale_date" });
    expect(grantMock).not.toHaveBeenCalled();
    expect(updates).toEqual([{ subscription_minutes_reset_at: null }]);
  });
});

describe("listStaleSubscriptionResetUserIds", () => {
  it("returns ids from the stale-reset query", async () => {
    const { supabase, staleIds } = mockSupabase({
      stripe_customer_id: "cus_1",
      subscription_minutes_reset_at: PAST,
    });
    staleIds.push("user-a", "user-b");
    await expect(listStaleSubscriptionResetUserIds(supabase, NOW, 50)).resolves.toEqual([
      "user-a",
      "user-b",
    ]);
  });
});
