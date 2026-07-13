export interface DumpSegment {
  seq: number;
  phase: string;
  step: number | null;
  title: string | null;
  pacing_wpm: number;
  target_duration_sec: number;
  actual_duration_sec?: number | null;
  pause_after_ms: number;
  scheduled_pause_after_ms?: number | null;
  text: string;
}

export interface ScriptDumpOptions {
  scriptId?: string;
}

function formatDurationLine(segment: DumpSegment): string {
  const parts = [`target ${segment.target_duration_sec}s`];
  if (segment.actual_duration_sec != null) {
    parts.push(`actual ${segment.actual_duration_sec}s`);
  }
  parts.push(`pause after ${segment.pause_after_ms}ms`);
  if (segment.scheduled_pause_after_ms != null) {
    parts.push(`scheduled pause ${segment.scheduled_pause_after_ms}ms`);
  }
  return `Durations: ${parts.join(" | ")}`;
}

export function formatScriptDump(
  segments: DumpSegment[],
  options: ScriptDumpOptions = {},
): string {
  const lines: string[] = [];
  if (options.scriptId) {
    lines.push(`Script: ${options.scriptId}`);
    lines.push("");
  }
  for (const segment of segments) {
    lines.push(`--- Segment ${segment.seq} ---`);
    lines.push(`Phase: ${segment.phase}`);
    if (segment.step != null) lines.push(`Step: ${segment.step}`);
    if (segment.title) lines.push(`Title: ${segment.title}`);
    lines.push(`Pacing: ${segment.pacing_wpm} wpm`);
    lines.push(formatDurationLine(segment));
    lines.push("");
    lines.push("Text:");
    lines.push(segment.text);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
