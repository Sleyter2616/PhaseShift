"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackManifest } from "@/lib/playback/manifest";
import { EntrainmentEngine, type EntrainmentMode } from "@/lib/audio/engine";
import { JitDecodeWindow } from "@/lib/audio/decode-window";
import {
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
  debug,
  engineReady,
  onTestTone,
}: {
  debug: DebugSnapshot;
  engineReady: boolean;
  onTestTone: () => void;
}) {
  if (!IS_DEV) return null;

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

export function SessionPlayer({ manifest }: SessionPlayerProps) {
  const schedule = useMemo(() => computeSegmentSchedule(manifest.segments), [manifest.segments]);
  const glideBoundaries = useMemo(
    () => deriveGlideBoundaries(schedule, manifest.meta.entrainment_plan),
    [manifest.meta.entrainment_plan, schedule],
  );
  const totalSec = useMemo(() => totalPlaybackSec(schedule), [schedule]);
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
      void releaseWakeLock();
      disposeEngine();
    };
  }, [disposeEngine, releaseWakeLock, requestWakeLock, stage]);

  useEffect(() => {
    if (!IS_DEV || stage !== "readyToPlay") {
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
  }, [stage, updateDebugSnapshot]);

  const ensureDecoded = useCallback(async (seq: number) => {
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
  }, []);

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
    const decodeTargets = decodeWindowRef.current.decodeTargets(currentSeq, upcoming);
    for (const seq of decodeTargets) {
      void ensureDecoded(seq);
    }

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
  }, [ensureDecoded, glideBoundaries, releaseWakeLock, schedule, totalSec, updateDebugSnapshot]);

  const startPlayback = useCallback(async () => {
    setError(null);
    setStage("loading");

    try {
      const [{ sessionId: createdSessionId }, compressed] = await Promise.all([
        createSession(manifest.meta.script_id),
        fetchCompressedBuffers(manifest, (loaded, total) => {
          setFetchProgress({ loaded, total });
        }),
      ]);
      setSessionId(createdSessionId);
      compressedRef.current = compressed;
      setStage("readyToPlay");
    } catch (beginError) {
      const message = beginError instanceof Error ? beginError.message : "failed to begin session";
      setError(message);
      setStage("prebegin");
    }
  }, [manifest]);

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

  const debugStrip = (
    <AudioDebugStrip
      debug={debug}
      engineReady={engineReady}
      onTestTone={handleTestTone}
    />
  );

  const debugPad = IS_DEV && (stage === "readyToPlay" || stage === "playing" || stage === "paused");

  if (stage === "prebegin") {
    return (
      <main className="mx-auto max-w-xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Before you begin</h1>
        <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-neutral-700">
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
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          onClick={() => void startPlayback()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Begin session
        </button>
      </main>
    );
  }

  if (stage === "loading") {
    const pct =
      fetchProgress.total > 0
        ? Math.round((fetchProgress.loaded / fetchProgress.total) * 100)
        : 0;
    return (
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Preparing audio</h1>
        <p className="text-sm text-neutral-600">
          Downloading segments {fetchProgress.loaded}/{fetchProgress.total} ({pct}%)
        </p>
        <div className="h-2 w-full rounded bg-neutral-200">
          <div className="h-2 rounded bg-neutral-800" style={{ width: `${pct}%` }} />
        </div>
      </main>
    );
  }

  if (stage === "readyToPlay") {
    return (
      <>
        <main className={`mx-auto max-w-xl space-y-6 p-6 ${debugPad ? "pb-20" : ""}`}>
          <h1 className="text-xl font-semibold">Ready to play</h1>
          <p className="text-sm text-neutral-600">
            Segments downloaded. Tap below to start audio — your browser requires a direct tap to
            unlock sound.
          </p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button
            type="button"
            onClick={() => void startAudio()}
            className="w-full rounded bg-neutral-900 px-6 py-4 text-lg font-medium text-white"
          >
            Start audio
          </button>
        </main>
        {debugStrip}
      </>
    );
  }

  if (stage === "rating") {
    return (
      <main className="mx-auto max-w-xl space-y-6 p-6">
        <h1 className="text-xl font-semibold">How alert do you feel?</h1>
        <p className="text-sm text-neutral-600">Rate your alertness from 1 (very drowsy) to 5 (fully alert).</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setExitAlertness(value)}
              className={`h-10 w-10 rounded border text-sm ${
                exitAlertness === value
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          onClick={() => void submitRating()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Save and finish
        </button>
      </main>
    );
  }

  if (stage === "done") {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Session complete</h1>
        <p className="text-sm text-neutral-600">Your exit alertness rating was saved.</p>
      </main>
    );
  }

  return (
    <>
      <main className={`mx-auto max-w-xl space-y-6 p-6 ${debugPad ? "pb-20" : ""}`}>
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Current phase</p>
          <p className="text-2xl font-semibold capitalize">{currentPhase ?? "—"}</p>
          <p className="text-sm text-neutral-600">
            {formatTime(elapsedSec)} / {formatTime(totalSec)}
          </p>
        </header>

        <div className="space-y-4 rounded border border-neutral-200 p-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void togglePause()}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            >
              {stage === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => void handleEnd()}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            >
              End session
            </button>
          </div>

          <label className="block text-sm">
            Voice volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={voiceGain}
              onChange={(event) => handleVoiceGain(Number(event.target.value))}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-sm">
            Tone volume
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={toneGain}
              onChange={(event) => handleToneGain(Number(event.target.value))}
              className="mt-1 w-full"
            />
          </label>

          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">Entrainment mode</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === "isochronic"}
                onChange={() => handleModeChange("isochronic")}
              />
              Isochronic (speakers OK)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === "binaural"}
                onChange={() => handleModeChange("binaural")}
              />
              Binaural (requires headphones)
            </label>
          </fieldset>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <p className="text-xs text-neutral-500">Keep this screen visible for uninterrupted playback.</p>
      </main>
      {debugStrip}
    </>
  );
}
