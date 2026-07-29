import { describe, expect, it, vi, afterEach } from "vitest";
import type { ServiceClient } from "../db/service-client";
import {
  STUCK_GENERATING_AGE_MS,
  STUCK_GENERATING_ERROR,
  findStuckGeneratingScripts,
  reapStuckGeneratingScript,
  runStuckGenerationReaper,
  shouldReapStuckGenerating,
} from "./stuck-generation-reaper";

function minutesAgoIso(minutes: number, nowMs: number): string {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

describe("shouldReapStuckGenerating", () => {
  const now = Date.parse("2026-07-29T06:00:00.000Z");

  it("reaps generating scripts older than 10 min with zero ready segments", () => {
    expect(
      shouldReapStuckGenerating({
        status: "generating",
        createdAt: minutesAgoIso(11, now),
        readySegmentCount: 0,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("leaves healthy in-progress scripts untouched (<10 min)", () => {
    expect(
      shouldReapStuckGenerating({
        status: "generating",
        createdAt: minutesAgoIso(5, now),
        readySegmentCount: 0,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("leaves scripts making progress (ready segments > 0) untouched", () => {
    expect(
      shouldReapStuckGenerating({
        status: "generating",
        createdAt: minutesAgoIso(30, now),
        readySegmentCount: 3,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("ignores non-generating statuses", () => {
    expect(
      shouldReapStuckGenerating({
        status: "synthesizing",
        createdAt: minutesAgoIso(30, now),
        readySegmentCount: 0,
        nowMs: now,
      }),
    ).toBe(false);
  });
});

describe("runStuckGenerationReaper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks stuck generating script failed and refunds unrefunded spend exactly once", async () => {
    const now = Date.parse("2026-07-29T06:00:00.000Z");
    const scriptId = "script-stuck-1";
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let refundLookupCount = 0;
    let scriptStatus = "generating";
    const updates: Array<Record<string, unknown>> = [];

    const supabase = {
      from(table: string) {
        if (table === "scripts") {
          return {
            select() {
              return {
                eq() {
                  return {
                    lt: async () => ({
                      data: [
                        {
                          id: scriptId,
                          user_id: "user-1",
                          created_at: minutesAgoIso(15, now),
                          status: "generating",
                        },
                      ],
                      error: null,
                    }),
                  };
                },
              };
            },
            update(payload: Record<string, unknown>) {
              updates.push(payload);
              return {
                eq(_col: string) {
                  if (_col === "id") {
                    return {
                      eq(_col2: string, statusVal: string) {
                        if (statusVal === "generating" && scriptStatus === "generating") {
                          scriptStatus = String(payload.status);
                        }
                        return Promise.resolve({ error: null });
                      },
                    };
                  }
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }
        if (table === "script_segments") {
          return {
            select(_cols: string, opts?: { count?: string; head?: boolean }) {
              if (opts?.head) {
                return {
                  eq() {
                    return {
                      eq: async () => ({ count: 0, error: null }),
                    };
                  },
                };
              }
              return {
                eq() {
                  return {
                    neq: async () => ({ error: null }),
                  };
                },
              };
            },
            update() {
              return {
                eq() {
                  return {
                    neq: async () => ({ error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === "minutes_ledger") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq(_reasonCol: string, reason: string) {
                      if (reason === "refund") {
                        refundLookupCount += 1;
                        // First reap: no refund yet. Second call in same test via
                        // re-running refund would see rows if we simulate after RPC.
                        return {
                          limit: async () => ({
                            data: refundLookupCount > 1 ? [{ id: "refund-1" }] : [],
                            error: null,
                          }),
                        };
                      }
                      // spend rows
                      return Promise.resolve({
                        data: [
                          { delta: -30, pool: "subscription" },
                          { delta: -15, pool: "topup" },
                        ],
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { error: null };
      },
    } as unknown as ServiceClient;

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await runStuckGenerationReaper(supabase, now);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      scriptId,
      minutesRefunded: 45,
      alreadyRefunded: false,
      markedFailed: true,
    });
    expect(results[0]!.ageMs).toBeGreaterThanOrEqual(STUCK_GENERATING_AGE_MS);
    expect(updates.some((u) => u.status === "failed")).toBe(true);
    expect(updates.some((u) => String(u.error_message).includes("STUCK_GENERATING"))).toBe(
      true,
    );
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls.map((c) => c.args.p_minutes)).toEqual([30, 15]);

    // Second reap path: already has refund row → no double refund.
    const second = await reapStuckGeneratingScript(
      supabase,
      {
        id: scriptId,
        user_id: "user-1",
        created_at: minutesAgoIso(15, now),
        status: "generating",
      },
      now,
    );
    expect(second.alreadyRefunded).toBe(true);
    expect(second.minutesRefunded).toBe(0);
    expect(rpcCalls).toHaveLength(2); // unchanged

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("stuck-generation-reaper:"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("minutes_refunded=45"));
    void STUCK_GENERATING_ERROR;
  });

  it("does not reap a fresh generating script", async () => {
    const now = Date.parse("2026-07-29T06:00:00.000Z");
    const supabase = {
      from(table: string) {
        if (table === "scripts") {
          return {
            select() {
              return {
                eq() {
                  return {
                    lt: async () => ({ data: [], error: null }),
                  };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc: vi.fn(),
    } as unknown as ServiceClient;

    vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await runStuckGenerationReaper(supabase, now);
    expect(results).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("findStuckGeneratingScripts skips candidates that have ready segments", async () => {
    const now = Date.parse("2026-07-29T06:00:00.000Z");
    const supabase = {
      from(table: string) {
        if (table === "scripts") {
          return {
            select() {
              return {
                eq() {
                  return {
                    lt: async () => ({
                      data: [
                        {
                          id: "script-progress",
                          user_id: "user-1",
                          created_at: minutesAgoIso(20, now),
                          status: "generating",
                        },
                      ],
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === "script_segments") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq: async () => ({ count: 2, error: null }),
                  };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as ServiceClient;

    const stuck = await findStuckGeneratingScripts(supabase, now);
    expect(stuck).toEqual([]);
  });
});
