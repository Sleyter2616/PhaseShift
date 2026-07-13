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

export function clampSeekTarget(targetSec: number, totalSec: number): number {
  if (totalSec <= 0) return 0;
  return Math.max(0, Math.min(targetSec, totalSec));
}

export interface SeekResolvedPosition {
  targetSec: number;
  segmentSeq: number | null;
  intraSegmentOffsetSec: number;
  inVoice: boolean;
  segmentStartSec: number;
}

export function resolveSeekPosition(
  schedule: ReadonlyArray<SegmentSchedule>,
  targetSec: number,
  totalSec: number,
): SeekResolvedPosition {
  const clamped = clampSeekTarget(targetSec, totalSec);
  const segmentSeq = segmentSeqAtElapsed(schedule, clamped);
  if (segmentSeq == null) {
    const last = schedule.at(-1);
    return {
      targetSec: clamped,
      segmentSeq: last?.seq ?? null,
      intraSegmentOffsetSec: 0,
      inVoice: false,
      segmentStartSec: last?.startSec ?? 0,
    };
  }

  const entry = schedule.find((item) => item.seq === segmentSeq);
  if (!entry) {
    return {
      targetSec: clamped,
      segmentSeq,
      intraSegmentOffsetSec: 0,
      inVoice: false,
      segmentStartSec: 0,
    };
  }

  const offsetInSegment = clamped - entry.startSec;
  const inVoice = offsetInSegment < entry.voiceDurationSec;
  return {
    targetSec: clamped,
    segmentSeq,
    intraSegmentOffsetSec: inVoice ? offsetInSegment : 0,
    inVoice,
    segmentStartSec: entry.startSec,
  };
}

export function voiceSeqsCompletedBySeek(
  schedule: ReadonlyArray<SegmentSchedule>,
  targetSec: number,
): number[] {
  return schedule
    .filter((entry) => entry.startSec + entry.voiceDurationSec <= targetSec + 1e-6)
    .map((entry) => entry.seq);
}

export function glideKeysTriggeredBefore(
  boundaries: ReadonlyArray<GlideBoundary>,
  targetSec: number,
): string[] {
  return boundaries
    .filter((glide) => glide.atSec < targetSec - 1e-6)
    .map((glide) => `${glide.fromPhase}:${glide.atSec}`);
}

export interface SeekPlanSegment {
  seq: number;
  entrainment_hz: number;
}

export interface SeekPlan {
  targetSec: number;
  position: SeekResolvedPosition;
  completedVoiceSeqs: number[];
  triggeredGlideKeys: string[];
  entrainmentHz: number;
}

export function buildSeekPlan(
  schedule: ReadonlyArray<SegmentSchedule>,
  glideBoundaries: ReadonlyArray<GlideBoundary>,
  segments: ReadonlyArray<SeekPlanSegment>,
  targetSec: number,
  totalSec: number,
): SeekPlan {
  const position = resolveSeekPosition(schedule, targetSec, totalSec);
  const landed =
    position.segmentSeq != null
      ? segments.find((segment) => segment.seq === position.segmentSeq)
      : undefined;
  const fallbackHz = segments[0]?.entrainment_hz ?? 10;

  return {
    targetSec: position.targetSec,
    position,
    completedVoiceSeqs: voiceSeqsCompletedBySeek(schedule, position.targetSec),
    triggeredGlideKeys: glideKeysTriggeredBefore(glideBoundaries, position.targetSec),
    entrainmentHz: landed?.entrainment_hz ?? fallbackHz,
  };
}
