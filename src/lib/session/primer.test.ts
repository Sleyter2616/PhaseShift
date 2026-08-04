import { describe, expect, it } from "vitest";
import {
  needsSessionPrimer,
  SESSION_PRIMER_POINTS,
  SESSION_PRIMER_TITLE,
} from "./primer";

describe("session primer", () => {
  it("needs primer when primer_seen_at is null or missing", () => {
    expect(needsSessionPrimer(null)).toBe(true);
    expect(needsSessionPrimer(undefined)).toBe(true);
  });

  it("skips primer once primer_seen_at is set", () => {
    expect(needsSessionPrimer("2026-08-01T12:00:00.000Z")).toBe(false);
  });

  it("keeps four calm pointers and the Before you begin title", () => {
    expect(SESSION_PRIMER_TITLE).toBe("Before you begin");
    expect(SESSION_PRIMER_POINTS).toHaveLength(4);
    expect(SESSION_PRIMER_POINTS[0]).toMatch(/headphones/i);
    expect(SESSION_PRIMER_POINTS[3]).toMatch(/wash over you/i);
  });
});
