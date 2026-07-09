import type { EntrainmentPlanItem } from "@/lib/playback/manifest";

export interface SchedulableSegment {
  seq: number;
  phase: string;
  actual_duration_sec: number;
  scheduled_pause_after_ms: number;
}

export interface SegmentSchedule {
  seq: number;
  phase: string;
  startSec: number;
  voiceDurationSec: number;
  pauseAfterSec: number;
  endSec: number;
}

export interface GlideBoundary {
  atSec: number;
  fromHz: number;
  toHz: number;
  durationSec: number;
  fromPhase: string;
}

export function computeSegmentSchedule(segments: ReadonlyArray<SchedulableSegment>): SegmentSchedule[] {
  const ordered = [...segments].sort((a, b) => a.seq - b.seq);
  let cursor = 0;

  return ordered.map((segment) => {
    const startSec = cursor;
    const voiceDurationSec = segment.actual_duration_sec;
    const pauseAfterSec = segment.scheduled_pause_after_ms / 1000;
    const endSec = startSec + voiceDurationSec + pauseAfterSec;
    cursor = endSec;

    return {
      seq: segment.seq,
      phase: segment.phase,
      startSec,
      voiceDurationSec,
      pauseAfterSec,
      endSec,
    };
  });
}

export function deriveGlideBoundaries(
  schedule: ReadonlyArray<SegmentSchedule>,
  entrainmentPlan: ReadonlyArray<EntrainmentPlanItem>,
): GlideBoundary[] {
  const boundaries: GlideBoundary[] = [];

  for (const plan of entrainmentPlan) {
    if (plan.glide_to == null || plan.glide_sec == null || plan.glide_sec <= 0) continue;

    const phaseSegments = schedule.filter((entry) => entry.phase === plan.phase);
    if (phaseSegments.length === 0) continue;

    const lastInPhase = phaseSegments.at(-1)!;
    const nextPhaseStart = schedule.find((entry) => entry.startSec >= lastInPhase.endSec - 1e-6);

    boundaries.push({
      atSec: nextPhaseStart?.startSec ?? lastInPhase.endSec,
      fromHz: plan.hz,
      toHz: plan.glide_to,
      durationSec: plan.glide_sec,
      fromPhase: plan.phase,
    });
  }

  return boundaries.sort((a, b) => a.atSec - b.atSec);
}

export function totalPlaybackSec(schedule: ReadonlyArray<SegmentSchedule>): number {
  const last = schedule.at(-1);
  return last?.endSec ?? 0;
}

export const LOOKAHEAD_SEC = 3;
export const TICK_MS = 200;
export const DECODE_LEAD_TICKS = 1;

export interface ScheduledVoiceEvent {
  seq: number;
  atCtxTime: number;
}

export function voicesDueInWindow(
  schedule: ReadonlyArray<SegmentSchedule>,
  sessionStartCtxTime: number,
  ctxNow: number,
  alreadyScheduled: ReadonlySet<number>,
): ScheduledVoiceEvent[] {
  const windowEnd = ctxNow + LOOKAHEAD_SEC;
  const events: ScheduledVoiceEvent[] = [];

  for (const entry of schedule) {
    if (alreadyScheduled.has(entry.seq)) continue;
    const atCtxTime = sessionStartCtxTime + entry.startSec;
    if (atCtxTime >= ctxNow && atCtxTime <= windowEnd) {
      events.push({ seq: entry.seq, atCtxTime });
    }
  }

  return events;
}

export function glidesDueInWindow(
  boundaries: ReadonlyArray<GlideBoundary>,
  sessionStartCtxTime: number,
  ctxNow: number,
  alreadyTriggered: ReadonlySet<string>,
): GlideBoundary[] {
  const windowEnd = ctxNow + LOOKAHEAD_SEC;
  const due: GlideBoundary[] = [];

  for (const glide of boundaries) {
    const key = `${glide.fromPhase}:${glide.atSec}`;
    if (alreadyTriggered.has(key)) continue;
    const atCtxTime = sessionStartCtxTime + glide.atSec;
    if (atCtxTime >= ctxNow && atCtxTime <= windowEnd) {
      due.push(glide);
    }
  }

  return due;
}

export function segmentSeqForCtxTime(
  schedule: ReadonlyArray<SegmentSchedule>,
  sessionStartCtxTime: number,
  ctxNow: number,
): number | null {
  const elapsed = ctxNow - sessionStartCtxTime;
  return segmentSeqAtElapsed(schedule, elapsed);
}

export function segmentSeqAtElapsed(
  schedule: ReadonlyArray<SegmentSchedule>,
  elapsedSec: number,
): number | null {
  for (const entry of schedule) {
    if (elapsedSec >= entry.startSec && elapsedSec < entry.endSec) {
      return entry.seq;
    }
  }
  return null;
}

export function phaseAtElapsed(
  schedule: ReadonlyArray<SegmentSchedule>,
  elapsedSec: number,
): string | null {
  for (const entry of schedule) {
    if (elapsedSec >= entry.startSec && elapsedSec < entry.endSec) {
      return entry.phase;
    }
  }
  return schedule.at(-1)?.phase ?? null;
}

export function upcomingSegmentSeqs(
  schedule: ReadonlyArray<SegmentSchedule>,
  sessionStartCtxTime: number,
  ctxNow: number,
  limit = 2,
): number[] {
  const elapsed = ctxNow - sessionStartCtxTime;
  return schedule
    .filter((entry) => entry.startSec > elapsed)
    .slice(0, limit)
    .map((entry) => entry.seq);
}
