import { describe, expect, it } from "vitest";
import {
  checkIntakeStringsVerbatim,
  checkPhaseTimingClosure,
  countBannedTokensInTheta,
  formatBannedTokenWarning,
  parseOveragePhases,
} from "./phase1-verify";

describe("checkIntakeStringsVerbatim", () => {
  it("passes on exact case match", () => {
    const result = checkIntakeStringsVerbatim("Goal at Meridian Labs office.", [
      "Meridian Labs office",
    ]);
    expect(result.ok).toBe(true);
    expect(result.caseNormalized).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it("passes with case-normalized match when sentence-initial cap differs", () => {
    const result = checkIntakeStringsVerbatim(
      "the senior engineer role at meridian labs is mine now.",
      ["The senior engineer role at Meridian Labs is mine now."],
    );
    expect(result.ok).toBe(true);
    expect(result.caseNormalized).toBe(true);
  });

  it("fails when string is absent even after case folding", () => {
    const result = checkIntakeStringsVerbatim("alpha text only", ["missing phrase"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["missing phrase"]);
  });

  it("preserves exact whitespace requirements", () => {
    const result = checkIntakeStringsVerbatim("two  spaces", ["two spaces"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["two spaces"]);
  });
});

describe("countBannedTokensInTheta", () => {
  it("counts banned tokens with word boundaries only", () => {
    const counts = countBannedTokensInTheta("I will try; no wish left.");
    expect(counts.get("will")).toBe(1);
    expect(counts.get("try")).toBe(1);
    expect(counts.get("wish")).toBe(1);
    expect(counts.size).toBe(3);
  });

  it("does not false-positive on willing or unwanted", () => {
    const counts = countBannedTokensInTheta("I am willing and unwanted noise fades.");
    expect(counts.size).toBe(0);
  });

  it("formats per-token warning counts", () => {
    const counts = countBannedTokensInTheta("will will someday");
    expect(formatBannedTokenWarning(counts)).toBe(
      "WARN banned tokens in theta text: 3 (will: 2, someday: 1)",
    );
  });
});

describe("phase timing closure (D11)", () => {
  it("passes when voiced plus pauses are within 2% of budget", () => {
    const result = checkPhaseTimingClosure(
      [
        { actual_duration_sec: 50, scheduled_pause_after_ms: 29_500 },
        { actual_duration_sec: 40, scheduled_pause_after_ms: 500 },
      ],
      120,
      false,
    );
    expect(result.ok).toBe(true);
  });

  it("requires zero scheduled pauses for overage phases and reports overage %", () => {
    const bad = checkPhaseTimingClosure(
      [{ actual_duration_sec: 130, scheduled_pause_after_ms: 1000 }],
      120,
      true,
    );
    expect(bad.ok).toBe(false);

    const good = checkPhaseTimingClosure(
      [{ actual_duration_sec: 130, scheduled_pause_after_ms: 0 }],
      120,
      true,
    );
    expect(good.ok).toBe(true);
    expect(good.overagePct).toBeCloseTo(8.333, 2);
  });

  it("parses overage phases from script error_message", () => {
    expect(parseOveragePhases("OVERAGE: phases beta,theta exceed voiced budget by >2%")).toEqual(
      new Set(["beta", "theta"]),
    );
  });
});
