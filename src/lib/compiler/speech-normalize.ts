const ISO_DATE_REGEX = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

const TIMEFRAME_PRESET_SPEECH: Record<string, string> = {
  "30d": "thirty days",
  "60d": "sixty days",
  "90d": "ninety days",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

const ORDINAL_ONES = [
  "zeroth",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
] as const;

const ORDINAL_TENS: Record<number, string> = {
  20: "twentieth",
  30: "thirtieth",
  40: "fortieth",
  50: "fiftieth",
  60: "sixtieth",
  70: "seventieth",
  80: "eightieth",
  90: "ninetieth",
};

const CURRENCY_REGEX =
  /\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?([KMB])?(\+)?/gi;

const TIME_WITH_MINUTES_REGEX = /\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/gi;
const TIME_SIMPLE_REGEX = /\b(\d{1,2})\s*(AM|PM)\b/gi;

const SLASH_RATIO_REGEX = /\b\d+\/\d+\b/g;
const UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

interface ProtectedSpan {
  token: string;
  value: string;
}

export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`numberToWords expects a non-negative integer, got ${n}`);
  }
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return one === 0 ? TENS[ten]! : `${TENS[ten]}-${ONES[one]}`;
  }
  if (n < 1000) {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return rest === 0
      ? `${ONES[hundred]} hundred`
      : `${ONES[hundred]} hundred ${numberToWords(rest)}`;
  }
  if (n < 1_000_000) {
    const thousand = Math.floor(n / 1000);
    const rest = n % 1000;
    const thousandWords = thousand === 1 ? "one thousand" : `${numberToWords(thousand)} thousand`;
    return rest === 0 ? thousandWords : `${thousandWords} ${numberToWords(rest)}`;
  }
  if (n < 1_000_000_000) {
    const million = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    const millionWords = million === 1 ? "one million" : `${numberToWords(million)} million`;
    return rest === 0 ? millionWords : `${millionWords} ${numberToWords(rest)}`;
  }
  throw new Error(`numberToWords unsupported magnitude: ${n}`);
}

export function ordinalToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`ordinalToWords expects a non-negative integer, got ${n}`);
  }
  if (n < 20) return ORDINAL_ONES[n]!;
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    if (one === 0) return ORDINAL_TENS[ten] ?? `${TENS[ten]}th`;
    return `${TENS[ten]}-${ORDINAL_ONES[one]}`;
  }
  const lastTwo = n % 100;
  const prefix = numberToWords(n - lastTwo);
  if (lastTwo === 0) return `${prefix}th`;
  return `${prefix}-${ordinalToWords(lastTwo)}`;
}

export function yearToSpeech(year: number): string {
  if (year >= 2000 && year <= 2099) {
    const remainder = year % 100;
    if (remainder === 0) return "two thousand";
    if (remainder < 10) return `twenty oh ${ONES[remainder]}`;
    return `twenty ${numberToWords(remainder)}`;
  }
  if (year >= 1900 && year <= 1999) {
    const remainder = year % 100;
    if (remainder === 0) return `${numberToWords(Math.floor(year / 100))} hundred`;
    return `${numberToWords(Math.floor(year / 100))} ${numberToWords(remainder)}`;
  }
  return numberToWords(year);
}

export function isoDateToSpoken(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`expected ISO date YYYY-MM-DD, got ${iso}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(`${iso}T12:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`invalid ISO date: ${iso}`);
  }
  return `${MONTH_NAMES[month - 1]} ${ordinalToWords(day)}, ${yearToSpeech(year)}`;
}

function parseCurrencyAmount(raw: string, decimals: string | undefined, suffix: string | undefined): number {
  const base = Number(raw.replace(/,/g, ""));
  if (Number.isNaN(base)) throw new Error(`invalid currency amount: ${raw}`);
  const scale =
    suffix?.toUpperCase() === "K"
      ? 1_000
      : suffix?.toUpperCase() === "M"
        ? 1_000_000
        : suffix?.toUpperCase() === "B"
          ? 1_000_000_000
          : 1;
  const fractional = decimals ? Number(`0.${decimals}`) : 0;
  return base * scale + fractional * scale;
}

function currencyToSpeech(
  raw: string,
  decimals: string | undefined,
  suffix: string | undefined,
  plus: string | undefined,
): string {
  const amount = Math.round(parseCurrencyAmount(raw, decimals, suffix));
  const spoken = `${numberToWords(amount)} dollars`;
  return plus ? `${spoken} or more` : spoken;
}

function timeToSpeech(hourText: string, minuteText: string | undefined, meridiem: string): string {
  const hour = Number(hourText);
  const hourWords = numberToWords(hour);
  const letters = meridiem.toUpperCase().split("").join(" ");
  if (minuteText === undefined || minuteText === "00") {
    return `${hourWords} ${letters}`;
  }
  const minute = Number(minuteText);
  return `${hourWords} ${numberToWords(minute)} ${letters}`;
}

function protectPatterns(text: string): { text: string; protectedSpans: ProtectedSpan[] } {
  const protectedSpans: ProtectedSpan[] = [];
  let index = 0;
  const patterns = [SLASH_RATIO_REGEX, UUID_REGEX];

  let working = text;
  for (const pattern of patterns) {
    working = working.replace(pattern, (match) => {
      const token = `\u0000PROT${index++}\u0000`;
      protectedSpans.push({ token, value: match });
      return token;
    });
  }
  return { text: working, protectedSpans };
}

function restoreProtected(text: string, protectedSpans: ProtectedSpan[]): string {
  let restored = text;
  for (const span of protectedSpans) {
    restored = restored.replaceAll(span.token, span.value);
  }
  return restored;
}

function normalizeCurrency(text: string): string {
  return text.replace(CURRENCY_REGEX, (_match, raw, decimals, suffix, plus) =>
    currencyToSpeech(raw, decimals, suffix, plus),
  );
}

function normalizeIsoDates(text: string): string {
  return text.replace(ISO_DATE_REGEX, (match) => isoDateToSpoken(match));
}

function normalizeTimes(text: string): string {
  let result = text.replace(TIME_WITH_MINUTES_REGEX, (_match, hour, minute, meridiem) =>
    timeToSpeech(hour, minute, meridiem),
  );
  result = result.replace(TIME_SIMPLE_REGEX, (_match, hour, meridiem) =>
    timeToSpeech(hour, undefined, meridiem),
  );
  return result;
}

function normalizeBareIntegers(text: string): string {
  return text.replace(/\b(\d+)\b/g, (match) => {
    if (match.length === 1) return numberToWords(Number(match));
    return numberToWords(Number(match));
  });
}

export function normalizeSpeech(text: string): string {
  const { text: protectedText, protectedSpans } = protectPatterns(text);
  let normalized = protectedText;
  normalized = normalizeCurrency(normalized);
  normalized = normalizeIsoDates(normalized);
  normalized = normalizeTimes(normalized);
  normalized = normalizeBareIntegers(normalized);
  return restoreProtected(normalized, protectedSpans);
}

export function normalizeTimeframeValue(timeframe: string): string {
  const preset = TIMEFRAME_PRESET_SPEECH[timeframe];
  if (preset) return preset;
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeframe)) return isoDateToSpoken(timeframe);
  return normalizeSpeech(timeframe);
}

export function normalizeDeadlineValue(deadline: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return isoDateToSpoken(deadline);
  return normalizeSpeech(deadline);
}
