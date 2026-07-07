const BREAK_TAG_REGEX = /<break\s+time="(\d+(?:\.\d{1,2})?)s"\s*\/>/gi;

export interface StripBreaksResult {
  cleanText: string;
  totalBreakMs: number;
}

/**
 * Removes valid `<break time="X.Xs"/>` tags and sums their durations in ms.
 * Malformed break-like tags are left in cleanText and ignored for timing.
 */
export function stripBreaks(text: string): StripBreaksResult {
  let totalBreakMs = 0;
  const cleanText = text.replace(BREAK_TAG_REGEX, (_match, seconds: string) => {
    const parsed = Number(seconds);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      totalBreakMs += Math.round(parsed * 1000);
    }
    return "";
  });

  return { cleanText, totalBreakMs };
}
