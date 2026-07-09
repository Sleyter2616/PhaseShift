import { describe, expect, it, vi } from "vitest";
import { uploadAudioWithRetry } from "./synthesize-segment-job";

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
