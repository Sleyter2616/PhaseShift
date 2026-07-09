import { describe, expect, it } from "vitest";
import { ensureClockAlive } from "./clock-watchdog";

describe("ensureClockAlive", () => {
  it("returns false when currentTime is frozen", async () => {
    const ctx = { currentTime: 0 };
    const alive = await ensureClockAlive(ctx, {
      waitMs: 50,
      delay: async () => {},
    });
    expect(alive).toBe(false);
  });

  it("returns true when currentTime advances during the wait", async () => {
    const ctx = { currentTime: 0 };
    const alive = await ensureClockAlive(ctx, {
      waitMs: 50,
      delay: async () => {
        ctx.currentTime = 0.25;
      },
    });
    expect(alive).toBe(true);
  });

  it("returns false when currentTime is unchanged but non-zero", async () => {
    const ctx = { currentTime: 1.5 };
    const alive = await ensureClockAlive(ctx, {
      waitMs: 10,
      delay: async () => {},
    });
    expect(alive).toBe(false);
  });
});
