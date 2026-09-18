import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ServiceClient } from "../db/service-client";
import type { SynthesizeSegmentInput } from "./synthesize-segment-job";

vi.mock("./dedupe-plan", () => ({
  linkPendingSegmentsFromAudioCache: vi.fn(async () => 0),
}));

vi.mock("./finalize-script", () => ({
  finalizeSynthesizedScript: vi.fn(async () => ({ totalSec: 1800, overageWarning: null })),
  phaseBudgetFromCompilerInput: vi.fn(() => ({ beta: 90, alpha: 270, theta: 1260, gamma: 180 })),
}));

vi.mock("./synthesis-identity", () => ({
  loadScriptSynthesisIdentity: vi.fn(async () => ({
    provider: "elevenlabs",
    assetScope: "shared",
    voiceId: "stock",
    modelId: "eleven_flash_v2_5",
    settings: {},
    storageScopeKey: "stock",
  })),
}));

import { linkPendingSegmentsFromAudioCache } from "./dedupe-plan";
import { finalizeSynthesizedScript } from "./finalize-script";
import {
  formatSynthesisReapAttempt,
  MAX_SYNTHESIS_REAP_ATTEMPTS,
  nextSynthesizingReapDecision,
  parseSynthesisReapAttempts,
  reapOneStuckScript,
  shouldLeaveForSynthesisReaper,
  type StuckScriptRow,
} from "./reap-stuck-scripts";

const linkMock = vi.mocked(linkPendingSegmentsFromAudioCache);
const finalizeMock = vi.mocked(finalizeSynthesizedScript);

const NOW = new Date("2026-09-18T12:00:00.000Z");
const OLD = new Date(NOW.getTime() - 11 * 60 * 1000).toISOString();

const compilerInput = { session: { phase_budget_sec: { beta: 90, alpha: 270, theta: 1260, gamma: 180 } } };

type SegmentState = {
  id: string;
  seq: number;
  text: string;
  pacing_wpm: number;
  content_hash: string;
  synthesis_status: string;
};

function scriptRow(overrides: Partial<StuckScriptRow> = {}): StuckScriptRow {
  return {
    id: "script-1",
    user_id: "user-1",
    status: "synthesizing",
    created_at: OLD,
    error_message: null,
    compiler_input: compilerInput,
    provider: "elevenlabs",
    stock_voice_id: "stock",
    voice_profile_id: null,
    tts_model_id: "eleven_flash_v2_5",
    ...overrides,
  };
}

function makeSupabase(opts: {
  script: ReturnType<typeof scriptRow>;
  segments: SegmentState[];
  readyCount?: number;
}) {
  const segments = opts.segments.map((s) => ({ ...s }));
  const script = { ...opts.script };
  const scriptUpdates: Array<Record<string, unknown>> = [];
  const segmentUpdates: Array<{ id?: string; patch: Record<string, unknown> }> = [];

  const supabase = {
    from(table: string) {
      if (table === "scripts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: script, error: null }),
              single: async () => ({ data: script, error: null }),
            }),
            in: () => ({
              lt: () => ({
                limit: async () => ({ data: [script], error: null }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            scriptUpdates.push(patch);
            Object.assign(script, patch);
            return {
              eq: () => ({
                eq: async () => ({ error: null }),
                then: (resolve: (v: unknown) => unknown) =>
                  resolve({ error: null }),
              }),
            };
          },
        };
      }
      if (table === "script_segments") {
        return {
          select: (columns: string, extra?: { count?: string; head?: boolean }) => {
            if (extra?.count === "exact") {
              return {
                eq: () => ({
                  eq: async () => ({
                    count:
                      opts.readyCount ??
                      segments.filter((s) => s.synthesis_status === "ready").length,
                    error: null,
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                order: async () => ({ data: segments, error: null }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => {
            let targetId: string | undefined;
            const builder = {
              eq: (col: string, val: string) => {
                if (col === "id") targetId = val;
                const row = segments.find((s) => s.id === targetId);
                if (row && col === "id") Object.assign(row, patch);
                segmentUpdates.push({ id: targetId, patch });
                return {
                  eq: () => ({
                    neq: async () => {
                      if (row && row.synthesis_status !== "ready") Object.assign(row, patch);
                      return { error: null };
                    },
                    then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
                  }),
                  neq: async () => ({ error: null }),
                };
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { supabase: supabase as unknown as ServiceClient, script, segments, scriptUpdates };
}

describe("synthesis reaper helpers", () => {
  it("parses SYNTHESIS_REAP attempt stamps", () => {
    expect(parseSynthesisReapAttempts(null)).toBe(0);
    expect(parseSynthesisReapAttempts("other")).toBe(0);
    expect(parseSynthesisReapAttempts(formatSynthesisReapAttempt(2))).toBe(2);
  });

  it("retries until MAX attempts then fails", () => {
    expect(nextSynthesizingReapDecision({ stuckSegmentCount: 0, priorAttempts: 0 })).toBe(
      "finalize",
    );
    expect(nextSynthesizingReapDecision({ stuckSegmentCount: 1, priorAttempts: 0 })).toBe("retry");
    expect(nextSynthesizingReapDecision({ stuckSegmentCount: 1, priorAttempts: 1 })).toBe("retry");
    expect(
      nextSynthesizingReapDecision({
        stuckSegmentCount: 1,
        priorAttempts: MAX_SYNTHESIS_REAP_ATTEMPTS,
      }),
    ).toBe("fail");
  });

  it("leaves synthesizing scripts for the reaper instead of failing the whole job", () => {
    expect(shouldLeaveForSynthesisReaper("synthesizing")).toBe(true);
    expect(shouldLeaveForSynthesisReaper("generating")).toBe(false);
    expect(shouldLeaveForSynthesisReaper("failed")).toBe(false);
  });
});

describe("reapOneStuckScript", () => {
  beforeEach(() => {
    linkMock.mockReset();
    linkMock.mockResolvedValue(0);
    finalizeMock.mockReset();
    finalizeMock.mockResolvedValue({ totalSec: 1800, overageWarning: null });
  });

  it("re-triggers a stuck pending segment on a synthesizing script", async () => {
    const sent: SynthesizeSegmentInput[] = [];
    const failed: string[] = [];
    const { supabase } = makeSupabase({
      script: scriptRow(),
      segments: [
        {
          id: "seg-ready",
          seq: 1,
          text: "Ready.",
          pacing_wpm: 100,
          content_hash: "h1",
          synthesis_status: "ready",
        },
        {
          id: "seg-stuck",
          seq: 2,
          text: "Dropped.",
          pacing_wpm: 105,
          content_hash: "h2",
          synthesis_status: "pending",
        },
      ],
    });

    const result = await reapOneStuckScript(scriptRow(), {
      supabase,
      now: NOW,
      sendSynthesize: async (input) => {
        sent.push(input);
      },
      markFailed: async (id) => {
        failed.push(id);
      },
    });

    expect(result).toEqual({
      scriptId: "script-1",
      action: "retried",
      segmentIds: ["seg-stuck"],
      attempt: 1,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.segment_id).toBe("seg-stuck");
    expect(sent[0]?.text).toBe("Dropped.");
    expect(failed).toEqual([]);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("finalizes when every segment is already ready", async () => {
    const sent: SynthesizeSegmentInput[] = [];
    const { supabase } = makeSupabase({
      script: scriptRow(),
      segments: [
        {
          id: "seg-a",
          seq: 1,
          text: "A",
          pacing_wpm: 100,
          content_hash: "h1",
          synthesis_status: "ready",
        },
        {
          id: "seg-b",
          seq: 2,
          text: "B",
          pacing_wpm: 100,
          content_hash: "h2",
          synthesis_status: "ready",
        },
      ],
    });

    const result = await reapOneStuckScript(scriptRow(), {
      supabase,
      now: NOW,
      sendSynthesize: async (input) => {
        sent.push(input);
      },
      markFailed: async () => {
        throw new Error("should not fail");
      },
    });

    expect(result.action).toBe("finalized");
    expect(sent).toEqual([]);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it("fails and refunds after repeated retriggers still leave a pending segment", async () => {
    const sent: SynthesizeSegmentInput[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    const { supabase } = makeSupabase({
      script: scriptRow({ error_message: formatSynthesisReapAttempt(2) }),
      segments: [
        {
          id: "seg-ready",
          seq: 1,
          text: "Ready.",
          pacing_wpm: 100,
          content_hash: "h1",
          synthesis_status: "ready",
        },
        {
          id: "seg-stuck",
          seq: 2,
          text: "Still dropped.",
          pacing_wpm: 105,
          content_hash: "h2",
          synthesis_status: "pending",
        },
      ],
    });

    const result = await reapOneStuckScript(scriptRow({ error_message: formatSynthesisReapAttempt(2) }), {
      supabase,
      now: NOW,
      sendSynthesize: async (input) => {
        sent.push(input);
      },
      markFailed: async (id, message) => {
        failed.push({ id, message });
      },
    });

    expect(result.action).toBe("failed_synthesis");
    expect(sent).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.id).toBe("script-1");
    expect(failed[0]?.message).toMatch(/2 dropped-segment retrigger/);
  });

  it("fails a generating script with zero ready segments", async () => {
    const failed: string[] = [];
    const { supabase } = makeSupabase({
      script: scriptRow({ status: "generating" }),
      segments: [],
      readyCount: 0,
    });

    const result = await reapOneStuckScript(scriptRow({ status: "generating" }), {
      supabase,
      now: NOW,
      sendSynthesize: async () => {
        throw new Error("should not synthesize");
      },
      markFailed: async (id) => {
        failed.push(id);
      },
    });

    expect(result.action).toBe("failed_generating");
    expect(failed).toEqual(["script-1"]);
  });
});
