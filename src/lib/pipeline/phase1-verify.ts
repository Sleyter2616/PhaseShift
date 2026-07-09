export const THETA_BANNED_TOKENS = [
  "will",
  "would",
  "could",
  "might",
  "hope",
  "wish",
  "try",
  "want",
  "someday",
] as const;

export interface IntakeVerbatimResult {
  ok: boolean;
  missing: string[];
  caseNormalized: boolean;
}

/** Case-insensitive substring match; whitespace on both sides stays exact. */
export function checkIntakeStringsVerbatim(
  concatText: string,
  stringsToFind: ReadonlyArray<string>,
): IntakeVerbatimResult {
  const missing: string[] = [];
  let caseNormalized = false;

  for (const needle of stringsToFind) {
    if (concatText.includes(needle)) continue;
    if (concatText.toLowerCase().includes(needle.toLowerCase())) {
      caseNormalized = true;
      continue;
    }
    missing.push(needle);
  }

  return { ok: missing.length === 0, missing, caseNormalized };
}

export function countBannedTokensInTheta(text: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of THETA_BANNED_TOKENS) {
    const matches = text.match(new RegExp(`\\b${token}\\b`, "gi")) ?? [];
    if (matches.length > 0) {
      counts.set(token, matches.length);
    }
  }

  return counts;
}

export function formatBannedTokenWarning(counts: Map<string, number>): string {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return "WARN banned tokens in theta text: 0";

  const detail = [...counts.entries()].map(([token, count]) => `${token}: ${count}`).join(", ");
  return `WARN banned tokens in theta text: ${total} (${detail})`;
}

export interface PhaseSegmentTiming {
  actual_duration_sec: number | null;
  scheduled_pause_after_ms: number | null;
}

export interface PhaseTimingCheckResult {
  ok: boolean;
  detail: string;
  overagePct?: number;
}

export function parseOveragePhases(errorMessage: string | null | undefined): Set<string> {
  if (!errorMessage?.includes("OVERAGE:")) return new Set();
  const match = errorMessage.match(/OVERAGE: phases ([^\s]+)/);
  if (!match?.[1]) return new Set();
  return new Set(match[1].split(","));
}

export function checkPhaseTimingClosure(
  segments: ReadonlyArray<PhaseSegmentTiming>,
  budgetSec: number,
  isOveragePhase: boolean,
): PhaseTimingCheckResult {
  const voicedSec = segments.reduce((sum, segment) => sum + Number(segment.actual_duration_sec ?? 0), 0);
  const pauseSec = segments.reduce(
    (sum, segment) => sum + Number(segment.scheduled_pause_after_ms ?? 0) / 1000,
    0,
  );
  const totalSec = voicedSec + pauseSec;
  const tolerance = budgetSec * 0.02;
  const delta = Math.abs(totalSec - budgetSec);

  if (isOveragePhase) {
    const allPausesZero = segments.every((segment) => (segment.scheduled_pause_after_ms ?? 0) === 0);
    const overagePct = budgetSec > 0 ? ((voicedSec - budgetSec) / budgetSec) * 100 : 0;
    if (!allPausesZero) {
      return {
        ok: false,
        detail: `scheduled pauses not all zero (voiced=${voicedSec.toFixed(1)}s)`,
      };
    }
    return {
      ok: true,
      detail: `overage ${overagePct.toFixed(1)}%`,
      overagePct,
    };
  }

  return {
    ok: delta <= tolerance,
    detail: `voiced+pause=${totalSec.toFixed(1)}s budget=${budgetSec}s delta=${delta.toFixed(1)}s`,
  };
}

export function findLongScheduledPauses(
  segments: ReadonlyArray<{ seq: number; scheduled_pause_after_ms: number | null }>,
  thresholdMs = 30_000,
): Array<{ seq: number; ms: number }> {
  return segments
    .filter((segment) => (segment.scheduled_pause_after_ms ?? 0) > thresholdMs)
    .map((segment) => ({ seq: segment.seq, ms: segment.scheduled_pause_after_ms ?? 0 }));
}
