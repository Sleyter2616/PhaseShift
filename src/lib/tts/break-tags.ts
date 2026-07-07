/** Exactly `<break time="X.Xs"/>` — double quotes, 0–2 decimal places, optional space before `/>`. */
export const CANONICAL_BREAK_REGEX =
  /<break\s+time="(\d+(?:\.\d{1,2})?)s"\s*\/>/gi;

/** Any `<break ...>` or `<break .../>` fragment (case-insensitive). */
export const LOOSE_BREAK_REGEX = /<break\b[^>]*\/?>/gi;

const CANONICAL_BREAK_ANCHORED =
  /^<break\s+time="(\d+(?:\.\d{1,2})?)s"\s*\/>$/i;

/** Returns seconds for a canonical tag string, otherwise null. */
export function parseBreakSeconds(tag: string): number | null {
  const match = CANONICAL_BREAK_ANCHORED.exec(tag.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isNaN(seconds) || seconds < 0 ? null : seconds;
}

export function isCanonicalBreakTag(tag: string): boolean {
  return parseBreakSeconds(tag) !== null;
}

export function findLooseBreakTags(text: string): string[] {
  return [...text.matchAll(new RegExp(LOOSE_BREAK_REGEX.source, LOOSE_BREAK_REGEX.flags))].map(
    (match) => match[0],
  );
}

export function findMalformedBreakTags(text: string): string[] {
  return findLooseBreakTags(text).filter((tag) => !isCanonicalBreakTag(tag));
}

export function maxCanonicalBreakSeconds(text: string): number {
  let max = 0;
  for (const tag of findLooseBreakTags(text)) {
    const seconds = parseBreakSeconds(tag);
    if (seconds !== null && seconds > max) max = seconds;
  }
  return max;
}
