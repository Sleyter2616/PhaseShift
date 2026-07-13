const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const PRESET_DAYS_SPEECH: Record<string, string> = {
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

export function isoDateToSpeech(iso: string): string {
  if (!ISO_DATE_REGEX.test(iso)) {
    throw new Error(`expected ISO date YYYY-MM-DD, got ${iso}`);
  }
  const parsed = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid ISO date: ${iso}`);
  }
  return `${MONTH_NAMES[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
}

export function timeframeToSpeech(timeframe: string): string {
  const preset = PRESET_DAYS_SPEECH[timeframe];
  if (preset) return preset;
  if (ISO_DATE_REGEX.test(timeframe)) return isoDateToSpeech(timeframe);
  return timeframe;
}

export function deadlineToSpeech(deadline: string): string {
  if (ISO_DATE_REGEX.test(deadline)) return isoDateToSpeech(deadline);
  return deadline;
}
