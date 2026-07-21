import { describe, expect, it, vi } from "vitest";
import type { ServiceClient } from "../db/service-client";
import {
  isInsufficientMinutesError,
  normalizeSpendRpcResult,
  refundMinutesBreakdown,
  refundMinutesForFailedScript,
} from "./refund-minutes";

describe("refund minutes helpers", () => {
  it("normalizes spend RPC object and array shapes", () => {
    expect(normalizeSpendRpcResult({ subscription_spent: 40, topup_spent: 40 })).toEqual({
      subscriptionSpent: 40,
      topupSpent: 40,
    });
    expect(normalizeSpendRpcResult([{ subscription_spent: 80, topup_spent: 0 }])).toEqual({
      subscriptionSpent: 80,
      topupSpent: 0,
    });
  });

  it("detects insufficient_minutes errors", () => {
    expect(isInsufficientMinutesError({ message: "insufficient_minutes" })).toBe(true);
    expect(isInsufficientMinutesError({ message: "other" })).toBe(false);
  });

  it("refundMinutesBreakdown refunds each pool touched", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { error: null };
      },
    } as unknown as ServiceClient;

    await refundMinutesBreakdown(supabase, "user-1", "script-1", {
      subscriptionSpent: 40,
      topupSpent: 40,
    });

    expect(rpcCalls).toEqual([
      {
        name: "refund_minutes",
        args: {
          p_user: "user-1",
          p_minutes: 40,
          p_pool: "subscription",
          p_script: "script-1",
        },
      },
      {
        name: "refund_minutes",
        args: {
          p_user: "user-1",
          p_minutes: 40,
          p_pool: "topup",
          p_script: "script-1",
        },
      },
    ]);
  });

  it("refundMinutesForFailedScript is idempotent when refund rows exist", async () => {
    const rpc = vi.fn();
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      limit: async () => ({ data: [{ id: "refund-1" }], error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      },
      rpc,
    } as unknown as ServiceClient;

    await refundMinutesForFailedScript(supabase, "user-1", "script-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refundMinutesForFailedScript reconstructs spend pools from ledger", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let ledgerQuery = 0;
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    ledgerQuery += 1;
                    if (ledgerQuery === 1) {
                      return { limit: async () => ({ data: [], error: null }) };
                    }
                    return Promise.resolve({
                      data: [
                        { delta: -40, pool: "subscription" },
                        { delta: -40, pool: "topup" },
                      ],
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { error: null };
      },
    } as unknown as ServiceClient;

    await refundMinutesForFailedScript(supabase, "user-1", "script-1");
    expect(rpcCalls).toEqual([
      {
        name: "refund_minutes",
        args: {
          p_user: "user-1",
          p_minutes: 40,
          p_pool: "subscription",
          p_script: "script-1",
        },
      },
      {
        name: "refund_minutes",
        args: {
          p_user: "user-1",
          p_minutes: 40,
          p_pool: "topup",
          p_script: "script-1",
        },
      },
    ]);
  });
});
