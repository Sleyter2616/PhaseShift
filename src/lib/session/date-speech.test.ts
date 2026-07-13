import { describe, expect, it } from "vitest";
import { deadlineToSpeech, isoDateToSpeech, timeframeToSpeech } from "./date-speech";

describe("isoDateToSpeech", () => {
  it("converts ISO dates to month-day speech without year", () => {
    expect(isoDateToSpeech("2026-05-07")).toBe("May 7");
    expect(isoDateToSpeech("2026-07-14")).toBe("July 14");
    expect(isoDateToSpeech("2026-01-01")).toBe("January 1");
  });
});

describe("timeframeToSpeech", () => {
  it("converts day presets to spoken duration", () => {
    expect(timeframeToSpeech("30d")).toBe("thirty days");
    expect(timeframeToSpeech("60d")).toBe("sixty days");
    expect(timeframeToSpeech("90d")).toBe("ninety days");
  });

  it("converts ISO timeframe dates to natural speech", () => {
    expect(timeframeToSpeech("2026-12-25")).toBe("December 25");
  });
});

describe("deadlineToSpeech", () => {
  it("converts ISO deadlines and passes through non-ISO text", () => {
    expect(deadlineToSpeech("2026-07-14")).toBe("July 14");
    expect(deadlineToSpeech("before Monday")).toBe("before Monday");
  });
});
