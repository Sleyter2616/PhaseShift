/** First-session / how-to primer copy (shared by session gate + /how-to). */

export const SESSION_PRIMER_TITLE = "Before you begin";

export const SESSION_PRIMER_POINTS = [
  "Use headphones — the entrainment tones and voice are layered for stereo.",
  "Find a quiet place where you won't be interrupted for the full session.",
  "Sit or lie down comfortably, eyes closed. Don't drive or operate anything — sessions guide you into a deeply relaxed state.",
  "Let it wash over you — you don't need to force anything; just follow the voice.",
] as const;

/** True when the user has not yet dismissed the first-session primer. */
export function needsSessionPrimer(primerSeenAt: string | null | undefined): boolean {
  return primerSeenAt == null;
}
