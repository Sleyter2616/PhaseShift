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

type PlayerStage = "prebegin" | "loading" | "playing" | "paused" | "rating" | "done";

interface SessionPlayerProps {
  manifest: PlaybackManifest;
}

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

  const engineRef = useRef<EntrainmentEngine | null>(null);
  const decodeWindowRef = useRef(new JitDecodeWindow(3));
  const compressedRef = useRef<Map<number, ArrayBuffer>>(new Map());
  const sessionStartCtxTimeRef = useRef<number | null>(null);
  const scheduledVoicesRef = useRef(new Set<number>());
  const triggeredGlidesRef = useRef(new Set<string>());
  const decodingRef = useRef(new Set<number>());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const disposeEngine = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    engineRef.current?.dispose();
    engineRef.current = null;
    decodeWindowRef.current = new JitDecodeWindow(3);
    compressedRef.current = new Map();
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

  const ensureDecoded = useCallback(async (seq: number) => {
    const engine = engineRef.current;
    const decodeWindow = decodeWindowRef.current;
    if (!engine || decodeWindow.has(seq) || decodingRef.current.has(seq)) return;

    const compressed = compressedRef.current.get(seq);
    if (!compressed) return;

    decodingRef.current.add(seq);
    try {
      const copy = compressed.slice(0);
      const audioBuffer = await engine.audioContext.decodeAudioData(copy);
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
  }, [ensureDecoded, glideBoundaries, releaseWakeLock, schedule, totalSec]);

  const startPlayback = useCallback(async () => {
    setError(null);

    const engine = new EntrainmentEngine(undefined, { mode, toneGain, voiceGain });
    engineRef.current = engine;

    try {
      await engine.resume();
      if (engine.audioContext.state !== "running") {
        setError("Audio was blocked by the browser — tap Begin again.");
        setStage("prebegin");
        disposeEngine();
        return;
      }

      void requestWakeLock();
      engine.startBed(initialBeatHz);
      setStage("loading");

      const [{ sessionId: createdSessionId }, compressed] = await Promise.all([
        createSession(manifest.meta.script_id),
        fetchCompressedBuffers(manifest, (loaded, total) => {
          setFetchProgress({ loaded, total });
        }),
      ]);
      setSessionId(createdSessionId);
      compressedRef.current = compressed;

      sessionStartCtxTimeRef.current = engine.audioContext.currentTime;
      setStage("playing");

      tickRef.current = setInterval(runSchedulerTick, TICK_MS);
      runSchedulerTick();
    } catch (beginError) {
      const message = beginError instanceof Error ? beginError.message : "failed to begin session";
      setError(message);
      setStage("prebegin");
      disposeEngine();
    }
  }, [
    disposeEngine,
    initialBeatHz,
    manifest,
    mode,
    requestWakeLock,
    runSchedulerTick,
    toneGain,
    voiceGain,
  ]);

  const togglePause = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (stage === "playing") {
      await engine.suspend();
      setStage("paused");
      return;
    }

    if (stage === "paused") {
      await engine.resume();
      setStage("playing");
      void requestWakeLock();
    }
  }, [requestWakeLock, stage]);

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
  }, []);

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
    <main className="mx-auto max-w-xl space-y-6 p-6">
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
  );
}
