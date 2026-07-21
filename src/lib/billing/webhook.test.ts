import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { ServiceClient } from "../db/service-client";
import {
  grantSubscriptionMinutesForUser,
  grantTopupMinutesForUser,
  handleStripeWebhookEvent,
  insertStripeEventIfNew,
  topupMinutesFromSession,
} from "./webhook";

function mockSupabase(overrides: {
  insertError?: { code?: string; message: string } | null;
  grantError?: { message: string } | null;
  rpcCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  profileUpdates?: Array<Record<string, unknown>>;
}) {
  const rpcCalls = overrides.rpcCalls ?? [];
  const profileUpdates = overrides.profileUpdates ?? [];
  const supabase = {
    from(table: string) {
      if (table === "stripe_events") {
        return {
          insert: vi.fn(async () => {
            if (overrides.insertError) return { error: overrides.insertError };
            return { error: null };
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "user-guided" }, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            profileUpdates.push(values);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (overrides.grantError) return { error: overrides.grantError };
      return { error: null };
    }),
  };
  return { supabase: supabase as unknown as ServiceClient, rpcCalls, profileUpdates };
}

describe("stripe webhook minutes grants", () => {
  it("insertStripeEventIfNew returns duplicate on primary key conflict", async () => {
    const { supabase } = mockSupabase({
      insertError: { code: "23505", message: "duplicate key" },
    });
    const result = await insertStripeEventIfNew(supabase, {
      id: "evt_test",
      type: "checkout.session.completed",
    });
    expect(result).toBe("duplicate");
  });

  it("grantTopupMinutesForUser calls grant_topup_minutes RPC", async () => {
    const { supabase, rpcCalls } = mockSupabase({});
    await grantTopupMinutesForUser(supabase, "user-1", 80);
    expect(rpcCalls).toEqual([
      { name: "grant_topup_minutes", args: { p_user: "user-1", p_minutes: 80 } },
    ]);
  });

  it("grantSubscriptionMinutesForUser calls grant_subscription_minutes RPC", async () => {
    const { supabase, rpcCalls } = mockSupabase({});
    await grantSubscriptionMinutesForUser(supabase, "user-1", 240, "2026-08-01T00:00:00.000Z");
    expect(rpcCalls).toEqual([
      {
        name: "grant_subscription_minutes",
        args: {
          p_user: "user-1",
          p_minutes: 240,
          p_period_end: "2026-08-01T00:00:00.000Z",
        },
      },
    ]);
  });

  it("topupMinutesFromSession prefers metadata minutes", () => {
    expect(
      topupMinutesFromSession({
        metadata: { minutes: "160" },
      } as unknown as Stripe.Checkout.Session),
    ).toBe(160);
    expect(
      topupMinutesFromSession({ metadata: {} } as unknown as Stripe.Checkout.Session),
    ).toBe(80);
  });

  it("checkout.session.completed payment grants topup minutes", async () => {
    const { supabase, rpcCalls } = mockSupabase({});
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { user_id: "user-abc", minutes: "80" },
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeWebhookEvent({ supabase, event });
    expect(rpcCalls).toEqual([
      { name: "grant_topup_minutes", args: { p_user: "user-abc", p_minutes: 80 } },
    ]);
  });

  it("invoice.paid grants monthly minutes and sets period end", async () => {
    vi.stubEnv("STRIPE_PRICE_GUIDED", "price_guided_test");
    const { supabase, rpcCalls, profileUpdates } = mockSupabase({});

    const event = {
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_1",
          parent: { subscription_details: { subscription: "sub_1" } },
          lines: {
            data: [
              {
                pricing: { price_details: { price: "price_guided_test" } },
                period: { end: 1785513600 },
              },
            ],
          },
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeWebhookEvent({ supabase, event });
    expect(rpcCalls).toEqual([
      {
        name: "grant_subscription_minutes",
        args: {
          p_user: "user-guided",
          p_minutes: 240,
          p_period_end: new Date(1785513600 * 1000).toISOString(),
        },
      },
    ]);
    expect(profileUpdates[0]).toMatchObject({
      subscription_status: "active",
      subscription_tier: "guided",
    });
    vi.unstubAllEnvs();
  });

  it("customer.subscription.deleted cancels without zeroing minutes", async () => {
    const { supabase, rpcCalls, profileUpdates } = mockSupabase({});
    const event = {
      type: "customer.subscription.deleted",
      data: {
        object: {
          customer: "cus_1",
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeWebhookEvent({ supabase, event });
    expect(rpcCalls).toEqual([]);
    expect(profileUpdates[0]).toEqual({
      subscription_status: "canceled",
      subscription_tier: null,
      tier: "trial",
    });
  });
});
