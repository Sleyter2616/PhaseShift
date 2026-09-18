import { describe, expect, it, vi } from "vitest";
import {
  isUniqueViolation,
  markSegmentSynthesisFailed,
  runSynthesizeSegment,
  uploadAudioWithRetry,
} from "./synthesize-segment-job";

describe("uploadAudioWithRetry", () => {
  it("retries twice with 500ms then 1500ms backoff before succeeding", async () => {
    const uploadFn = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "fetch failed" } })
      .mockResolvedValueOnce({ error: { message: "fetch failed" } })
      .mockResolvedValueOnce({ error: null });

    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });

    await uploadAudioWithRetry(uploadFn, sleepFn);

    expect(uploadFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1500]);
  });

  it("throws after exhausting retries", async () => {
    const uploadFn = vi.fn().mockResolvedValue({ error: { message: "fetch failed" } });
    const sleepFn = vi.fn(async () => {});

    await expect(uploadAudioWithRetry(uploadFn, sleepFn)).rejects.toThrow(
      "storage upload failed: fetch failed",
    );

    expect(uploadFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });
});

describe("isUniqueViolation", () => {
  it("detects postgres unique violations for audio_files dedupe indexes", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(
      isUniqueViolation({ message: "duplicate key value violates unique constraint" }),
    ).toBe(true);
    expect(isUniqueViolation({ message: "audio_files_shared_dedupe_idx" })).toBe(true);
    expect(isUniqueViolation({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("markSegmentSynthesisFailed", () => {
  it("sets synthesis_status to failed without touching ready rows", async () => {
    const filters: string[] = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("script_segments");
        return {
          update: (patch: Record<string, unknown>) => {
            expect(patch).toEqual({ synthesis_status: "failed" });
            return {
              eq: (col: string, val: string) => {
                filters.push(`${col}=${val}`);
                return {
                  eq: (col2: string, val2: string) => {
                    filters.push(`${col2}=${val2}`);
                    return {
                      neq: async (col3: string, val3: string) => {
                        filters.push(`${col3}!=${val3}`);
                        return { error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    await markSegmentSynthesisFailed(supabase as never, "script-1", "seg-1");
    expect(filters).toEqual(["id=seg-1", "script_id=script-1", "synthesis_status!=ready"]);
  });
});

describe("runSynthesizeSegment", () => {
  it("marks the segment failed when the job throws, never leaving it pending", async () => {
    const statusUpdates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: (table: string) => {
        if (table === "scripts") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { message: "missing script" } }),
              }),
            }),
          };
        }
        if (table === "script_segments") {
          return {
            update: (patch: Record<string, unknown>) => {
              statusUpdates.push(patch);
              return {
                eq: () => ({
                  eq: () => ({
                    neq: async () => ({ error: null }),
                  }),
                }),
              };
            },
          };
        }
        throw new Error(table);
      },
    };

    await expect(
      runSynthesizeSegment(supabase as never, {
        script_id: "script-1",
        segment_id: "seg-pending",
        user_id: "user-1",
        dedupe_key: "hash",
        text: "Speak.",
        pacing_wpm: 105,
      }),
    ).rejects.toThrow(/script load failed/);

    expect(statusUpdates).toEqual([{ synthesis_status: "failed" }]);
  });
});
