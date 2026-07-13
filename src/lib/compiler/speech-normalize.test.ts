import { describe, expect, it } from "vitest";
import {
  toSpeakableText,
  isoDateToSpoken,
  normalizeDeadlineValue,
  normalizeTimeframeValue,
  numberToWords,
  ordinalToWords,
} from "./speech-normalize";

describe("toSpeakableText", () => {
  it("aliases normalizeSpeech for backward compatibility", async () => {
    const { normalizeSpeech, toSpeakableText } = await import("./speech-normalize");
    expect(normalizeSpeech("$1M")).toBe(toSpeakableText("$1M"));
  });
});

describe("currency normalization", () => {
  it("converts script 62fcbabf currency tokens", () => {
    expect(toSpeakableText("$1M")).toBe("one million dollars");
    expect(toSpeakableText("$25K+")).toBe("twenty-five thousand dollars or more");
    expect(toSpeakableText("$83,333")).toBe(
      "eighty-three thousand three hundred thirty-three dollars",
    );
    expect(toSpeakableText("$1,000,000")).toBe("one million dollars");
  });

  it("normalizes currency embedded in prose", () => {
    expect(toSpeakableText("Offer lands at $1M before close.")).toBe(
      "Offer lands at one million dollars before close.",
    );
  });
});

describe("ISO date normalization", () => {
  it("converts ISO dates to spoken month, ordinal day, and year", () => {
    expect(isoDateToSpoken("2027-05-07")).toBe("May seventh, twenty twenty-seven");
    expect(toSpeakableText("Deadline 2026-07-14 for review.")).toBe(
      "Deadline July fourteenth, twenty twenty-six for review.",
    );
  });

  it("normalizes dedicated deadline and timeframe fields", () => {
    expect(normalizeDeadlineValue("2026-07-14")).toBe("July fourteenth, twenty twenty-six");
    expect(normalizeTimeframeValue("90d")).toBe("ninety days");
    expect(normalizeTimeframeValue("2027-05-07")).toBe("May seventh, twenty twenty-seven");
  });
});

describe("integer normalization", () => {
  it("converts multi-digit and standalone digits to words", () => {
    expect(toSpeakableText("Panel in 14 days with 3 demos.")).toBe(
      "Panel in fourteen days with three demos.",
    );
    expect(toSpeakableText("Badge scan on the 15th floor")).toBe(
      "Badge scan on the 15th floor",
    );
  });

  it("preserves slash ratios and obvious identifiers", () => {
    expect(toSpeakableText("Coverage is 24/7 at lobby desk 42")).toBe(
      "Coverage is 24/7 at lobby desk forty-two",
    );
    expect(
      toSpeakableText("trace id 62fcbabf-0000-4000-8000-000000000000"),
    ).toBe("trace id 62fcbabf-0000-4000-8000-000000000000");
    expect(
      toSpeakableText("Details at https://example.com/offers/2027 remain unchanged."),
    ).toBe("Details at https://example.com/offers/2027 remain unchanged.");
  });
});

describe("time normalization", () => {
  it("converts clock times to spoken hour and spaced meridiem letters", () => {
    expect(toSpeakableText("Arrive by 9 AM for briefing.")).toBe(
      "Arrive by nine A M for briefing.",
    );
    expect(toSpeakableText("Call at 9:30 PM tonight.")).toBe(
      "Call at nine thirty P M tonight.",
    );
  });
});

describe("number helpers", () => {
  it("builds ordinals and large cardinals", () => {
    expect(ordinalToWords(7)).toBe("seventh");
    expect(numberToWords(83333)).toBe("eighty-three thousand three hundred thirty-three");
  });
});

describe("script 62fcbabf fixture strings", () => {
  it("normalizes the founder review bundle end-to-end", () => {
    const input =
      "Close the $1M offer by 2027-05-07; floor is $25K+ with $83,333 base and $1,000,000 upside. Arrive 9 AM, ops runs 24/7.";
    expect(toSpeakableText(input)).toBe(
      "Close the one million dollars offer by May seventh, twenty twenty-seven; floor is twenty-five thousand dollars or more with eighty-three thousand three hundred thirty-three dollars base and one million dollars upside. Arrive nine A M, ops runs 24/7.",
    );
  });
});
