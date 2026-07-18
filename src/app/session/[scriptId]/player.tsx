"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChoiceControl } from "@/components/choice-control";
import { Mark } from "@/components/mark";
import { SessionField } from "@/components/session-field";
import { PhaseJourney, SessionPulse } from "@/components/session-pulse";
import type { PlaybackManifest } from "@/lib/playback/manifest";
import { EntrainmentEngine, type EntrainmentMode } from "@/lib/audio/engine";
import { JitDecodeWindow } from "@/lib/audio/decode-window";
import {
  buildSeekPlan,
  clampSeekTarget,
  computeSegmentSchedule,
  deriveGlideBoundaries,
  glidesDueInWindow,
  phaseAtElapsed,
  segmentSeqForCtxTime,
  TICK_MS,
  totalPlaybackSec,
  upcomingSegmentSeqs,
  voicesDueInWindow,
} from "@/lib/audio/scheduler";
import { isTestGenerationProvider } from "@/lib/synthesis/provenance";
import { completeSession, createSession } from "./actions";

type PlayerStage =
  | "prebegin"
  | "loading"
  | "readyToPlay"
  | "playing"
  | "paused"
  | "rating"
  | "done";

interface SessionPlayerProps {
  manifest: PlaybackManifest;
}

interface DebugSnapshot {
  ctxState: string;
  ctxTime: number | null;
  elapsed: number;
  decoded: number;
  scheduled: number;
  bedActive: boolean;
  mode: EntrainmentMode;
  clock: "alive" | "dead" | "unknown";
  attempt: 1 | 2 | null;
  masterGain: number | null;
  toneGain: number | null;
  voiceGain: number | null;
}

const IS_DEV = process.env.NODE_ENV !== "production";

const EMPTY_DEBUG: DebugSnapshot = {
  ctxState: "none",
  ctxTime: null,
  elapsed: 0,
  decoded: 0,
  scheduled: 0,
  bedActive: false,
  mode: "isochronic",
  clock: "unknown",
  attempt: null,
  masterGain: null,
  toneGain: null,
  voiceGain: null,
};

function formatTime(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function fetchCompressedBuffers(
  manifest: PlaybackManifest,
  onProgress: (loaded: number, total: number) => void,
): Promise<Map<number, ArrayBuffer>> {
  const playable = manifest.segments.filter((segment) => segment.signedUrl);
  const buffers = new Map<number, ArrayBuffer>();
  let loaded = 0;

  await Promise.all(
    playable.map(async (segment) => {
      const response = await fetch(segment.signedUrl!);
      if (!response.ok) {
        throw new Error(`failed to fetch segment ${segment.seq}`);
      }
      const buffer = await response.arrayBuffer();
      buffers.set(segment.seq, buffer);
      loaded += 1;
      onProgress(loaded, playable.length);
    }),
  );

  return buffers;
}

function AudioDebugStrip({
  show,
  debug,
  engineReady,
  onTestTone,
}: {
  show: boolean;
  debug: DebugSnapshot;
  engineReady: boolean;
  onTestTone: () => void;
}) {
  if (!show) return null;

  const ctxTimeLabel = debug.ctxTime != null ? debug.ctxTime.toFixed(1) : "—";

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300 bg-amber-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-800">
      <div className="mx-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1">
        <span>ctx.state={debug.ctxState}</span>
        <span>ctx.t={ctxTimeLabel}</span>
        <span>elapsed={debug.elapsed.toFixed(1)}</span>
        <span>decoded:{debug.decoded}</span>
        <span>scheduled:{debug.scheduled}</span>
        <span>bedActive:{String(debug.bedActive)}</span>
        <span>mode={debug.mode}</span>
        <span>clock:{debug.clock}</span>
        <span>attempt:{debug.attempt ?? "—"}</span>
        <span>
          master:{debug.masterGain?.toFixed(3) ?? "—"} tone:{debug.toneGain?.toFixed(3) ?? "—"}{" "}
          voice:{debug.voiceGain?.toFixed(3) ?? "—"}
        </span>
        <button
          type="button"
          disabled={!engineReady}
          onClick={onTestTone}
          className="rounded border border-neutral-400 px-2 py-0.5 disabled:opacity-40"
        >
          Test tone
        </button>
      </div>
    </div>
  );
}

function useDebugStripEnabled(): boolean {
  const [queryEnabled, setQueryEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQueryEnabled(params.get("debug") === "1");
  }, []);

  return IS_DEV && queryEnabled;
}

export function SessionPlayer({ manifest }: SessionPlayerProps) {
  const isTestGeneration = isTestGenerationProvider(manifest.meta.provider);
  const schedule = useMemo(() => computeSegmentSchedule(manifest.segments), [manifest.segments]);
  const glideBoundaries = useMemo(
    () => deriveGlideBoundaries(schedule, manifest.meta.entrainment_plan),
    [manifest.meta.entrainment_plan, schedule],
  );
  const totalSec = useMemo(() => totalPlaybackSec(schedule), [schedule]);
  const phases = useMemo(
    () => manifest.meta.entrainment_plan.map((entry) => entry.phase),
    [manifest.meta.entrainment_plan],
  );
  const initialBeatHz =
    manifest.meta.entrainment_plan[0]?.hz ?? manifest.segments[0]?.entrainment_hz ?? 10;

  const [stage, setStage] = useState<PlayerStage>("prebegin");
  const [mode, setMode] = useState<EntrainmentMode>(manifest.meta.entrainment_mode);
  const [voiceGain, setVoiceGain] = useState(1);
  const [toneGain, setToneGain] = useState(0.12);
  const [fetchProgress, setFetchProgress] = useState({ loaded: 0, total: 0 });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exitAlertness, setExitAlertness] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DebugSnapshot>(EMPTY_DEBUG);
  const [scrubSec, setScrubSec] = useState<number | null>(null);
  const [showForwardSeekHint, setShowForwardSeekHint] = useState(false);
  const debugEnabled = useDebugStripEnabled();

  const engineRef = useRef<EntrainmentEngine | null>(null);
  const decodeWindowRef = useRef(new JitDecodeWindow(3));
  const compressedRef = useRef<Map<number, ArrayBuffer>>(new Map());
  const sessionStartCtxTimeRef = useRef<number | null>(null);
  const scheduledVoicesRef = useRef(new Set<number>());
  const triggeredGlidesRef = useRef(new Set<string>());
  const decodingRef = useRef(new Set<number>());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debugTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockStatusRef = useRef<DebugSnapshot["clock"]>("unknown");
  const attemptRef = useRef<DebugSnapshot["attempt"]>(null);
  const scrubWasPlayingRef = useRef(false);
  const forwardSeekHintSeenRef = useRef(false);

  const updateDebugSnapshot = useCallback(() => {
    const engine = engineRef.current;
    const sessionStart = sessionStartCtxTimeRef.current;
    const ctxTime = engine?.audioContext.currentTime ?? null;
    const elapsed =
      sessionStart != null && ctxTime != null ? Math.max(0, ctxTime - sessionStart) : 0;
    const gains = engine?.getGainLevels();

    setDebug({
      ctxState: engine?.audioContext.state ?? "none",
      ctxTime,
      elapsed,
      decoded: decodeWindowRef.current.aliveCount(),
      scheduled: scheduledVoicesRef.current.size,
      bedActive: engine?.isBedActive() ?? false,
      mode: engine?.currentMode ?? mode,
      clock: clockStatusRef.current,
      attempt: attemptRef.current,
      masterGain: gains?.master ?? null,
      toneGain: gains?.tone ?? null,
      voiceGain: gains?.voice ?? null,
    });
  }, [mode]);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      // unsupported or denied
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch {
      // already released
    }
    wakeLockRef.current = null;
  }, []);

  // Never place `stage` (or any per-render value) in the deps of an effect whose
  // cleanup disposes the engine — React runs cleanup on every dep change.
  const disposeEngine = useCallback((options?: { keepBuffers?: boolean }) => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    engineRef.current?.dispose();
    engineRef.current = null;
    if (IS_DEV) {
      delete (window as Window & { __psEngine?: EntrainmentEngine }).__psEngine;
    }
    attemptRef.current = null;
    decodeWindowRef.current.dispose();
    decodeWindowRef.current = new JitDecodeWindow(3);
    if (!options?.keepBuffers) {
      compressedRef.current = new Map();
    }
    sessionStartCtxTimeRef.current = null;
    scheduledVoicesRef.current = new Set();
    triggeredGlidesRef.current = new Set();
    decodingRef.current = new Set();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && stage === "playing") {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [requestWakeLock, stage]);

  // Unmount-only teardown — stable callbacks; do not add stage or other render deps.
  useEffect(
    () => () => {
      void releaseWakeLock();
      disposeEngine();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only intent
    [],
  );

  useEffect(() => {
    if (!debugEnabled || stage !== "readyToPlay") {
      if (debugTickRef.current) {
        clearInterval(debugTickRef.current);
        debugTickRef.current = null;
      }
      return;
    }

    updateDebugSnapshot();
    debugTickRef.current = setInterval(updateDebugSnapshot, TICK_MS);
    return () => {
      if (debugTickRef.current) {
        clearInterval(debugTickRef.current);
        debugTickRef.current = null;
      }
    };
  }, [debugEnabled, stage, updateDebugSnapshot]);

  const ensureDecoded = useCallback(async (seq: number) => {
    if (isTestGeneration) return;

    const decodeWindow = decodeWindowRef.current;
    if (decodeWindow.has(seq) || decodingRef.current.has(seq)) return;

    const compressed = compressedRef.current.get(seq);
    if (!compressed) return;

    decodingRef.current.add(seq);
    try {
      const audioBuffer = await decodeWindow.decode(compressed);
      decodeWindow.markDecoded(seq, audioBuffer);
    } catch (decodeError) {
      const message = decodeError instanceof Error ? decodeError.message : "decode failed";
      setError(message);
    } finally {
      decodingRef.current.delete(seq);
    }
  }, [isTestGeneration]);

  const runSchedulerTick = useCallback(() => {
    const engine = engineRef.current;
    const sessionStart = sessionStartCtxTimeRef.current;
    if (!engine || sessionStart == null) return;

    const ctx = engine.audioContext;
    const ctxNow = ctx.currentTime;
    const elapsed = Math.max(0, ctxNow - sessionStart);
    setElapsedSec(elapsed);
    setCurrentPhase(phaseAtElapsed(schedule, elapsed));
    updateDebugSnapshot();

    if (elapsed >= totalSec) {
      setStage("rating");
      void engine.suspend();
      void releaseWakeLock();
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }

    const currentSeq = segmentSeqForCtxTime(schedule, sessionStart, ctxNow);
    const upcoming = upcomingSegmentSeqs(schedule, sessionStart, ctxNow, 2);
    if (!isTestGeneration) {
      const decodeTargets = decodeWindowRef.current.decodeTargets(currentSeq, upcoming);
      for (const seq of decodeTargets) {
        void ensureDecoded(seq);
      }
    }

    if (!isTestGeneration) {
      const voices = voicesDueInWindow(schedule, sessionStart, ctxNow, scheduledVoicesRef.current);
      for (const voice of voices) {
        const buffer = decodeWindowRef.current.get<AudioBuffer>(voice.seq);
        if (!buffer) {
          void ensureDecoded(voice.seq);
          continue;
        }
        const source = engine.scheduleVoice(buffer, voice.atCtxTime);
        scheduledVoicesRef.current.add(voice.seq);
        source.onended = () => {
          decodeWindowRef.current.markPlayed(voice.seq);
        };
      }
    }

    const glides = glidesDueInWindow(
      glideBoundaries,
      sessionStart,
      ctxNow,
      triggeredGlidesRef.current,
    );
    for (const glide of glides) {
      const key = `${glide.fromPhase}:${glide.atSec}`;
      triggeredGlidesRef.current.add(key);
      const atCtxTime = sessionStart + glide.atSec;
      engine.glideBeat(glide.toHz, glide.durationSec, atCtxTime);
    }
  }, [ensureDecoded, glideBoundaries, isTestGeneration, releaseWakeLock, schedule, totalSec, updateDebugSnapshot]);

  const maybeShowForwardSeekHint = useCallback((deltaSec: number) => {
    if (deltaSec > 0 && !forwardSeekHintSeenRef.current) {
      forwardSeekHintSeenRef.current = true;
      setShowForwardSeekHint(true);
    }
  }, []);

  const seekTo = useCallback(
    async (targetSec: number) => {
      const engine = engineRef.current;
      if (!engine || sessionStartCtxTimeRef.current == null) return;
      if (stage !== "playing" && stage !== "paused") return;

      const plan = buildSeekPlan(
        schedule,
        glideBoundaries,
        manifest.segments.map((segment) => ({
          seq: segment.seq,
          entrainment_hz: segment.entrainment_hz,
        })),
        targetSec,
        totalSec,
      );

      engine.stopAllVoices();
      scheduledVoicesRef.current = new Set(plan.completedVoiceSeqs);
      triggeredGlidesRef.current = new Set(plan.triggeredGlideKeys);

      const ctxNow = engine.audioContext.currentTime;
      sessionStartCtxTimeRef.current = ctxNow - plan.targetSec;
      engine.setBeatHzImmediate(plan.entrainmentHz);

      setElapsedSec(plan.targetSec);
      setCurrentPhase(phaseAtElapsed(schedule, plan.targetSec));

      if (
        !isTestGeneration &&
        plan.position.segmentSeq != null &&
        plan.position.inVoice
      ) {
        const seq = plan.position.segmentSeq;
        await ensureDecoded(seq);
        const buffer = decodeWindowRef.current.get<AudioBuffer>(seq);
        if (buffer) {
          const source = engine.scheduleVoice(
            buffer,
            ctxNow,
            plan.position.intraSegmentOffsetSec,
          );
          scheduledVoicesRef.current.add(seq);
          source.onended = () => {
            decodeWindowRef.current.markPlayed(seq);
          };
        }
      }

      updateDebugSnapshot();
      runSchedulerTick();
    },
    [
      ensureDecoded,
      glideBoundaries,
      isTestGeneration,
      manifest.segments,
      runSchedulerTick,
      schedule,
      stage,
      totalSec,
      updateDebugSnapshot,
    ],
  );

  const handleSeekRelative = useCallback(
    (deltaSec: number) => {
      const base = scrubSec ?? elapsedSec;
      maybeShowForwardSeekHint(deltaSec);
      void seekTo(base + deltaSec);
    },
    [elapsedSec, maybeShowForwardSeekHint, scrubSec, seekTo],
  );

  const handleScrubStart = useCallback(() => {
    scrubWasPlayingRef.current = stage === "playing";
    if (scrubWasPlayingRef.current) {
      void engineRef.current?.suspend();
      setStage("paused");
    }
    setScrubSec(elapsedSec);
  }, [elapsedSec, stage]);

  const handleScrubChange = useCallback((value: number) => {
    setScrubSec(clampSeekTarget(value, totalSec));
  }, [totalSec]);

  const handleScrubEnd = useCallback(
    async (value: number) => {
      const target = clampSeekTarget(value, totalSec);
      maybeShowForwardSeekHint(target - elapsedSec);
      setScrubSec(null);
      await seekTo(target);
      if (scrubWasPlayingRef.current) {
        await engineRef.current?.resume();
        setStage("playing");
        void requestWakeLock();
      }
    },
    [elapsedSec, maybeShowForwardSeekHint, requestWakeLock, seekTo, totalSec],
  );

  const startPlayback = useCallback(async () => {
    setError(null);
    setStage("loading");

    try {
      const sessionPromise = createSession(manifest.meta.script_id);
      const compressed = isTestGeneration
        ? new Map<number, ArrayBuffer>()
        : await fetchCompressedBuffers(manifest, (loaded, total) => {
            setFetchProgress({ loaded, total });
          });
      const { sessionId: createdSessionId } = await sessionPromise;
      setSessionId(createdSessionId);
      compressedRef.current = compressed;
      if (isTestGeneration) {
        setFetchProgress({ loaded: 0, total: 0 });
      }
      setStage("readyToPlay");
    } catch (beginError) {
      const message = beginError instanceof Error ? beginError.message : "failed to begin session";
      setError(message);
      setStage("prebegin");
    }
  }, [isTestGeneration, manifest]);

  const startAudio = useCallback(async () => {
    setError(null);
    clockStatusRef.current = "unknown";
    updateDebugSnapshot();

    type TryFailureReason = "suspended" | "dead_clock" | "error";

    const tryStartEngine = async (
      createCtx: () => AudioContext,
    ): Promise<{ engine: EntrainmentEngine } | { reason: TryFailureReason }> => {
      const engine = new EntrainmentEngine(createCtx(), { mode, toneGain, voiceGain });
      try {
        await engine.resume();
        if (engine.audioContext.state !== "running") {
          engine.dispose();
          return { reason: "suspended" };
        }
        if (!(await engine.ensureClockAlive())) {
          engine.dispose();
          return { reason: "dead_clock" };
        }
        return { engine };
      } catch {
        engine.dispose();
        return { reason: "error" };
      }
    };

    const attempt1 = await tryStartEngine(() => new AudioContext());
    const attempt2 =
      "engine" in attempt1
        ? null
        : await tryStartEngine(() => new AudioContext({ latencyHint: "playback" }));

    const engine =
      attempt1 && "engine" in attempt1
        ? attempt1.engine
        : attempt2 && "engine" in attempt2
          ? attempt2.engine
          : null;

    if (!engine) {
      const sawDeadClock =
        ("reason" in attempt1 && attempt1.reason === "dead_clock") ||
        (attempt2 != null && "reason" in attempt2 && attempt2.reason === "dead_clock");

      clockStatusRef.current = sawDeadClock ? "dead" : "unknown";
      setError(
        sawDeadClock
          ? "Audio engine could not start (output clock stalled). Fully quit and reopen your browser, or try another browser."
          : "Audio was blocked by the browser — tap Start audio again.",
      );
      updateDebugSnapshot();
      disposeEngine({ keepBuffers: true });
      return;
    }

    engineRef.current = engine;
    clockStatusRef.current = "alive";
    attemptRef.current = attempt1 && "engine" in attempt1 ? 1 : 2;
    if (IS_DEV) {
      (window as Window & { __psEngine?: EntrainmentEngine }).__psEngine = engine;
    }
    void requestWakeLock();
    engine.startBed(initialBeatHz);
    sessionStartCtxTimeRef.current = engine.audioContext.currentTime;
    setStage("playing");
    updateDebugSnapshot();

    tickRef.current = setInterval(runSchedulerTick, TICK_MS);
    runSchedulerTick();
  }, [
    disposeEngine,
    initialBeatHz,
    mode,
    requestWakeLock,
    runSchedulerTick,
    toneGain,
    updateDebugSnapshot,
    voiceGain,
  ]);

  const handleTestTone = useCallback(() => {
    engineRef.current?.playTestTone();
  }, []);

  const togglePause = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (stage === "playing") {
      await engine.suspend();
      setStage("paused");
      updateDebugSnapshot();
      return;
    }

    if (stage === "paused") {
      await engine.resume();
      setStage("playing");
      void requestWakeLock();
      updateDebugSnapshot();
    }
  }, [requestWakeLock, stage, updateDebugSnapshot]);

  const handleEnd = useCallback(async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    await engineRef.current?.suspend();
    await releaseWakeLock();
    setStage("rating");
  }, [releaseWakeLock]);

  const handleModeChange = useCallback((nextMode: EntrainmentMode) => {
    setMode(nextMode);
    engineRef.current?.setMode(nextMode);
    updateDebugSnapshot();
  }, [updateDebugSnapshot]);

  const handleVoiceGain = useCallback((value: number) => {
    setVoiceGain(value);
    engineRef.current?.setVoiceGain(value);
  }, []);

  const handleToneGain = useCallback((value: number) => {
    setToneGain(value);
    engineRef.current?.setToneGain(value);
  }, []);

  const submitRating = useCallback(async () => {
    if (!sessionId) return;
    try {
      await completeSession({
        sessionId,
        progressSec: elapsedSec,
        exitAlertness,
      });
      disposeEngine();
      setStage("done");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "failed to save session";
      setError(message);
    }
  }, [disposeEngine, elapsedSec, exitAlertness, sessionId]);

  const engineReady = stage === "playing" || stage === "paused";
  const displayElapsedSec = scrubSec ?? elapsedSec;
  const currentBeatHz = useMemo(() => {
    const entry = manifest.meta.entrainment_plan.find((plan) => plan.phase === currentPhase);
    return entry?.hz ?? initialBeatHz;
  }, [currentPhase, initialBeatHz, manifest.meta.entrainment_plan]);

  const debugStrip = (
    <AudioDebugStrip
      show={debugEnabled}
      debug={debug}
      engineReady={engineReady}
      onTestTone={handleTestTone}
    />
  );

  const debugPad =
    debugEnabled && (stage === "readyToPlay" || stage === "playing" || stage === "paused");

  if (stage === "prebegin") {
    return (
      <SessionField phase="alpha" className="items-center justify-center px-4 py-10">
        <div className="session-column w-full max-w-md space-y-8">
          <div className="text-center">
            <Mark size={32} className="mx-auto mb-4" />
            <h1 className="font-display text-2xl font-normal">Before you begin</h1>
          </div>
          <ul className="space-y-4 text-sm leading-relaxed text-[var(--session-mid)]">
            <li>
              Entrainment tones use rhythmic frequencies that may affect people with a history of
              seizures or photosensitive epilepsy. Do not use this session if you have that history.
            </li>
            <li>Do not use PhaseShift while driving or operating machinery.</li>
            <li>
              PhaseShift is not a medical device and is not a substitute for professional medical or
              mental health care.
            </li>
            <li>
              Keep your screen on and leave this app in the foreground. v0 playback requires the
              session screen to stay visible.
            </li>
          </ul>
          {isTestGeneration ? (
            <p className="rounded-[var(--radius)] border border-[var(--border-hair)] px-3 py-2 text-sm text-[var(--color-warning)]">
              This is a test generation — it contains no synthesized speech.
            </p>
          ) : null}
          {error ? <p className="text-sm text-[var(--color-error)]">{error}</p> : null}
          <button
            type="button"
            onClick={() => void startPlayback()}
            className="btn-sand w-full py-3 text-base"
          >
            Begin session
          </button>
        </div>
      </SessionField>
    );
  }

  if (stage === "loading") {
    const pct =
      fetchProgress.total > 0
        ? Math.round((fetchProgress.loaded / fetchProgress.total) * 100)
        : 0;
    return (
      <SessionField phase="alpha" className="items-center justify-center px-4 py-10">
        <div className="session-column w-full max-w-md space-y-6 text-center">
          <Mark size={40} className="loading-mark mx-auto" />
          <h1 className="font-display text-xl font-normal">Preparing audio</h1>
          <p className="text-sm text-[var(--session-mid)]">
            Downloading segments {fetchProgress.loaded}/{fetchProgress.total} ({pct}%)
          </p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-hair)]">
            <div
              className="h-full rounded-full bg-[var(--session-accent)] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </SessionField>
    );
  }

  if (stage === "readyToPlay") {
    return (
      <>
        <SessionField
          phase="alpha"
          className={`items-center justify-center px-4 py-10 ${debugPad ? "pb-20" : ""}`}
        >
          <div className="session-column w-full max-w-md space-y-6 text-center">
            <SessionPulse beatHz={initialBeatHz} />
            <h1 className="font-display text-xl font-normal">Ready to play</h1>
            <p className="text-sm text-[var(--session-mid)]">
              Segments downloaded. Tap below to start audio — your browser requires a direct tap to
              unlock sound.
            </p>
            {error ? <p className="text-sm text-[var(--color-error)]">{error}</p> : null}
            <button
              type="button"
              onClick={() => void startAudio()}
              className="btn-sand w-full py-4 text-base"
            >
              Start audio
            </button>
          </div>
        </SessionField>
        {debugStrip}
      </>
    );
  }

  if (stage === "rating") {
    return (
      <SessionField phase="gamma" className="items-center justify-center px-4 py-10">
        <div className="session-column w-full max-w-md space-y-6">
          <h1 className="font-display text-center text-xl font-normal">How alert do you feel?</h1>
          <p className="text-center text-sm text-[var(--session-mid)]">
            Rate your alertness from 1 (very drowsy) to 5 (fully alert).
          </p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setExitAlertness(value)}
                aria-label={`Alertness ${value}`}
                className={`session-control h-11 w-11 ${
                  exitAlertness === value
                    ? "!border-[var(--session-accent)] !text-[var(--session-text)]"
                    : ""
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          {error ? <p className="text-sm text-[var(--color-error)]">{error}</p> : null}
          <button
            type="button"
            onClick={() => void submitRating()}
            className="btn-sand w-full py-3"
          >
            Save and finish
          </button>
        </div>
      </SessionField>
    );
  }

  if (stage === "done") {
    return (
      <SessionField phase="gamma" className="items-center justify-center px-4 py-10">
        <div className="session-column w-full max-w-md space-y-4 text-center">
          <Mark size={32} className="mx-auto" />
          <h1 className="font-display text-xl font-normal">Session complete</h1>
          <p className="text-sm text-[var(--session-mid)]">Your exit alertness rating was saved.</p>
        </div>
      </SessionField>
    );
  }

  return (
    <>
      <SessionField phase={currentPhase} className={debugPad ? "pb-20" : ""}>
        <div className="session-column flex flex-1 flex-col items-center justify-center px-4 py-6">
          <PhaseJourney phases={phases} currentPhase={currentPhase} />
          <SessionPulse beatHz={currentBeatHz} className="my-6 sm:my-8" />
          <p className="font-display text-center text-3xl font-normal capitalize sm:text-4xl">
            {currentPhase ?? "—"}
          </p>
          <p className="mt-2 text-sm text-[var(--session-mid)]">
            {formatTime(displayElapsedSec)} / {formatTime(totalSec)}
          </p>
        </div>

        <footer className="session-column space-y-4 px-4 pb-6 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Back 15 seconds"
              onClick={() => handleSeekRelative(-15)}
              className="session-control shrink-0 px-3 py-2.5 text-sm"
            >
              −15s
            </button>
            <input
              type="range"
              min={0}
              max={totalSec}
              step={0.1}
              value={displayElapsedSec}
              onPointerDown={handleScrubStart}
              onChange={(event) => handleScrubChange(Number(event.target.value))}
              onPointerUp={(event) => void handleScrubEnd(Number(event.currentTarget.value))}
              className="session-scrub w-full"
              aria-label="Session scrub bar"
            />
            <button
              type="button"
              aria-label="Forward 15 seconds"
              onClick={() => handleSeekRelative(15)}
              className="session-control shrink-0 px-3 py-2.5 text-sm"
            >
              +15s
            </button>
          </div>
          {showForwardSeekHint ? (
            <p className="text-center text-xs text-[var(--session-mid)]">
              Skipping ahead may reduce the induction effect.
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void togglePause()}
              className="session-control flex-1 py-3 text-sm"
            >
              {stage === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => void handleEnd()}
              className="session-control flex-1 py-3 text-sm"
            >
              End session
            </button>
          </div>

          <details className="session-panel text-sm text-[var(--session-mid)]">
            <summary className="cursor-pointer px-4 py-3 text-[var(--session-text)]">
              Session settings
            </summary>
            <div className="space-y-4 border-t border-[var(--border-hair)] px-4 py-4">
              <label className="block">
                <span className="mb-2 block">Voice volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={voiceGain}
                  onChange={(event) => handleVoiceGain(Number(event.target.value))}
                  className="session-scrub w-full"
                  aria-label="Voice volume"
                />
              </label>

              <label className="block">
                <span className="mb-2 block">Tone volume</span>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={toneGain}
                  onChange={(event) => handleToneGain(Number(event.target.value))}
                  className="session-scrub w-full"
                  aria-label="Tone volume"
                />
              </label>

              <fieldset className="space-y-2">
                <legend className="text-[var(--session-text)]">Entrainment mode</legend>
                <ChoiceControl
                  name="mode"
                  checked={mode === "isochronic"}
                  onChange={() => handleModeChange("isochronic")}
                >
                  Isochronic (speakers OK)
                </ChoiceControl>
                <ChoiceControl
                  name="mode"
                  checked={mode === "binaural"}
                  onChange={() => handleModeChange("binaural")}
                >
                  Binaural (requires headphones)
                </ChoiceControl>
              </fieldset>
            </div>
          </details>

          {error ? <p className="text-center text-sm text-[var(--color-error)]">{error}</p> : null}
          <p className="text-center text-xs text-[var(--session-mid)]">
            Keep this screen visible for uninterrupted playback.
          </p>
        </footer>
      </SessionField>
      {debugStrip}
    </>
  );
}
