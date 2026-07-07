import { describe, expect, it } from "vitest";
import { stripBreaks } from "./breaks";

describe("stripBreaks", () => {
  it("sums multiple valid break tags and removes them from cleanText", () => {
    const { cleanText, totalBreakMs } = stripBreaks(
      'Hello <break time="2.0s"/> world <break time="1.5s"/> end',
    );
    expect(cleanText).toBe("Hello  world  end");
    expect(totalBreakMs).toBe(3500);
  });

  it("returns zero break ms when no break tags are present", () => {
    const { cleanText, totalBreakMs } = stripBreaks("Plain speech only.");
    expect(cleanText).toBe("Plain speech only.");
    expect(totalBreakMs).toBe(0);
  });

  it("ignores malformed break tags without throwing", () => {
    const input = 'Start <break time="bad"/> middle <break time="3.333s"/> end';
    const { cleanText, totalBreakMs } = stripBreaks(input);
    expect(cleanText).toBe('Start <break time="bad"/> middle <break time="3.333s"/> end');
    expect(totalBreakMs).toBe(0);
  });

  it("accepts decimal seconds with one or two places", () => {
    const { totalBreakMs } = stripBreaks(
      'Pause <break time="1.2s"/> then <break time="2.05s"/> done',
    );
    expect(totalBreakMs).toBe(1200 + 2050);
  });
});
