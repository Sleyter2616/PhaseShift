import { CANONICAL_BREAK_REGEX, parseBreakSeconds } from "../tts/break-tags";
import type { Manifest } from "../contracts/manifest";

const PHASES = ["beta", "alpha", "theta", "gamma"] as const;

export interface NormalizeResult {
  manifest: unknown;
  actions: string[];
}

function formatBreakSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}.0`;
  if (Math.round(rounded * 10) === rounded * 10) return rounded.toFixed(1);
  return rounded.toFixed(2);
}

export function chainBreakTags(totalSeconds: number): string {
  const parts: string[] = [];
  let remaining = totalSeconds;

  while (remaining > 3.0) {
    parts.push('<break time="3.0s"/>');
    remaining -= 3.0;
  }

  if (remaining > 0) {
    parts.push(`<break time="${formatBreakSeconds(remaining)}s"/>`);
  }

  return parts.join("");
}

function chainLongBreaksInText(text: string, seq: number, actions: string[]): string {
  const regex = new RegExp(CANONICAL_BREAK_REGEX.source, CANONICAL_BREAK_REGEX.flags);

  return text.replace(regex, (match) => {
    const seconds = parseBreakSeconds(match);
    if (seconds === null || seconds <= 3.0) return match;

    const chained = chainBreakTags(seconds);
    actions.push(
      `segment seq ${seq}: chained <break time="${formatBreakSeconds(seconds)}s"/> into ${partsLabel(chained)}`,
    );
    return chained;
  });
}

function partsLabel(chained: string): string {
  const matches = [...chained.matchAll(/time="([^"]+)"/g)].map((m) => `${m[1]}s`);
  return matches.join(" + ");
}

function rescalePhaseDurations(
  segments: Array<{ target_duration_sec: number; seq: number }>,
  budget: number,
  phase: string,
  actions: string[],
): void {
  const sum = segments.reduce((acc, segment) => acc + segment.target_duration_sec, 0);
  if (sum === 0) return;

  const deviation = Math.abs(sum - budget) / budget;
  if (deviation > 0.05) return;

  if (sum === budget) return;

  const scaled = segments.map((segment) => ({
    ...segment,
    target_duration_sec: Math.max(1, Math.round((segment.target_duration_sec * budget) / sum)),
  }));

  const drift = budget - scaled.reduce((acc, segment) => acc + segment.target_duration_sec, 0);
  const longest = scaled.reduce((best, segment) =>
    segment.target_duration_sec > best.target_duration_sec ? segment : best,
  );
  longest.target_duration_sec = Math.max(1, longest.target_duration_sec + drift);

  for (let i = 0; i < segments.length; i++) {
    const before = segments[i]!.target_duration_sec;
    const after = scaled[i]!.target_duration_sec;
    segments[i]!.target_duration_sec = after;
    if (before !== after) {
      actions.push(
        `phase ${phase}: rescaled segment seq ${segments[i]!.seq} target_duration_sec ${before} -> ${after}`,
      );
    }
  }

  actions.push(
    `phase ${phase}: rescaled segment targets ${sum} -> ${budget} (within 5% tolerance)`,
  );
}

export function normalizeManifest(json: unknown): NormalizeResult {
  const actions: string[] = [];

  if (!json || typeof json !== "object") {
    return { manifest: json, actions };
  }

  const manifest = JSON.parse(JSON.stringify(json)) as Manifest;

  if (!Array.isArray(manifest.segments) || !manifest.meta?.phase_budget_sec) {
    return { manifest, actions };
  }

  for (const segment of manifest.segments) {
    if (typeof segment.text === "string") {
      segment.text = chainLongBreaksInText(segment.text, segment.seq, actions);
    }
  }

  for (const phase of PHASES) {
    const budget = manifest.meta.phase_budget_sec[phase];
    const phaseSegments = manifest.segments.filter((segment) => segment.phase === phase);
    if (phaseSegments.length === 0) continue;
    rescalePhaseDurations(phaseSegments, budget, phase, actions);
  }

  return { manifest, actions };
}
