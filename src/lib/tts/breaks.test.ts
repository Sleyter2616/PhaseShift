import { describe, expect, it } from "vitest";
import { stripBreaks } from "./breaks";
import { isCanonicalBreakTag, parseBreakSeconds } from "./break-tags";

describe("stripBreaks", () => {
  it("sums multiple canonical break tags and removes them from cleanText", () => {
    const { cleanText, totalBreakMs } = stripBreaks(
      'Hello <break time="2.0s"/> world <break time="1.5s"/> end',
    );
    expect(cleanText).toBe("Hello  world  end");
    expect(cleanText.toLowerCase()).not.toContain("<break");
    expect(totalBreakMs).toBe(3500);
  });

  it("returns zero break ms when no break tags are present", () => {
    const { cleanText, totalBreakMs } = stripBreaks("Plain speech only.");
    expect(cleanText).toBe("Plain speech only.");
    expect(totalBreakMs).toBe(0);
  });

  it("removes malformed break tags from cleanText without crediting ms", () => {
    const input = 'Start <break time="bad"/> middle <break time="3.333s"/> end';
    const { cleanText, totalBreakMs } = stripBreaks(input);
    expect(cleanText).toBe("Start  middle  end");
    expect(cleanText.toLowerCase()).not.toContain("<break");
    expect(totalBreakMs).toBe(0);
  });

  it("accepts decimal seconds with one or two places", () => {
    const { totalBreakMs } = stripBreaks(
      'Pause <break time="1.2s"/> then <break time="2.05s"/> done',
    );
    expect(totalBreakMs).toBe(1200 + 2050);
  });
});

describe("parseBreakSeconds", () => {
  it("parses canonical tags only", () => {
    expect(parseBreakSeconds('<break time="2.0s"/>')).toBe(2);
    expect(parseBreakSeconds('<break time="1.575s"/>')).toBeNull();
    expect(isCanonicalBreakTag("<break time='2.0s'/>")).toBe(false);
  });
});
