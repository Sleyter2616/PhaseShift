import {
  findLooseBreakTags,
  isCanonicalBreakTag,
  LOOSE_BREAK_REGEX,
  parseBreakSeconds,
} from "./break-tags";

export interface StripBreaksResult {
  cleanText: string;
  totalBreakMs: number;
}

/**
 * Removes every loose `<break ...>` fragment from cleanText so nothing break-like
 * may ever reach TTS text. Credits totalBreakMs only for canonical
 * `<break time="X.Xs"/>` tags (double quotes, 1–2 decimal places).
 */
export function stripBreaks(text: string): StripBreaksResult {
  let totalBreakMs = 0;

  for (const tag of findLooseBreakTags(text)) {
    const seconds = parseBreakSeconds(tag);
    if (seconds !== null) {
      totalBreakMs += Math.round(seconds * 1000);
    }
  }

  const cleanText = text.replace(
    new RegExp(LOOSE_BREAK_REGEX.source, LOOSE_BREAK_REGEX.flags),
    "",
  );

  return { cleanText, totalBreakMs };
}

export { isCanonicalBreakTag, parseBreakSeconds };
