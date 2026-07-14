import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { ServiceClient } from "../db/service-client";
import {
  grantCreditsForUser,
  handleStripeWebhookEvent,
  insertStripeEventIfNew,
  topupCreditsFromSession,
} from "./webhook";

function mockSupabase(overrides: {
  insertError?: { code?: string; message: string } | null;
  grantError?: { message: string } | null;
  rpcCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}) {
  const rpcCalls = overrides.rpcCalls ?? [];
  const supabase = {
    from(table: string) {
      if (table !== "stripe_events") throw new Error(`unexpected table ${table}`);
      return {
        insert: vi.fn(async () => {
          if (overrides.insertError) return { error: overrides.insertError };
          return { error: null };
        }),
      };
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (overrides.grantError) return { error: overrides.grantError };
      return { error: null };
    }),
  };
  return { supabase: supabase as unknown as ServiceClient, rpcCalls };
}

describe("stripe webhook helpers", () => {
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

  it("grantCreditsForUser calls grant_credits RPC", async () => {
    const { supabase, rpcCalls } = mockSupabase({});
    await grantCreditsForUser(supabase, "user-1", 1, "purchase");
    expect(rpcCalls).toEqual([
      {
        name: "grant_credits",
        args: { p_user: "user-1", p_amount: 1, p_reason: "purchase", p_script: null },
      },
    ]);
  });

  it("topupCreditsFromSession prefers metadata credits", () => {
    expect(
      topupCreditsFromSession({
        metadata: { credits: "3" },
      } as unknown as Stripe.Checkout.Session),
    ).toBe(3);
    expect(
      topupCreditsFromSession({ metadata: {} } as unknown as Stripe.Checkout.Session),
    ).toBe(1);
  });

  it("checkout.session.completed payment grants purchase credits once per handler call", async () => {
    const { supabase, rpcCalls } = mockSupabase({});
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { user_id: "user-abc", credits: "1" },
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeWebhookEvent({ supabase, event });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: "grant_credits",
      args: { p_user: "user-abc", p_amount: 1, p_reason: "purchase" },
    });
  });

  it("invoice.paid grants monthly allotment for mapped tier price", async () => {
    vi.stubEnv("STRIPE_PRICE_GUIDED", "price_guided_test");
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: "user-guided" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { error: null };
      },
    } as unknown as ServiceClient;

    const event = {
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_1",
          parent: { subscription_details: { subscription: "sub_1" } },
          lines: {
            data: [{ pricing: { price_details: { price: "price_guided_test" } } }],
          },
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeWebhookEvent({ supabase, event });
    expect(rpcCalls).toEqual([
      {
        name: "grant_credits",
        args: { p_user: "user-guided", p_amount: 3, p_reason: "grant", p_script: null },
      },
    ]);
    vi.unstubAllEnvs();
  });
});
