"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  VOICE_CLONE_READING_PASSAGE,
  VOICE_SAMPLE_MIN_SEC,
  VOICE_SAMPLE_TARGET_SEC,
} from "@/lib/voice/reading-passage";
import { confirmVoiceConsent } from "./actions";

interface VoiceOnboardingProps {
  status: "none" | "pending" | "ready" | "failed";
  consentConfirmed: boolean;
  providerVoiceId: string | null;
  canRetryStoredSample: boolean;
}

export function VoiceOnboarding({
  status,
  consentConfirmed,
  providerVoiceId,
  canRetryStoredSample,
}: VoiceOnboardingProps) {
  const router = useRouter();
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [readyVoiceId, setReadyVoiceId] = useState<string | null>(providerVoiceId);
  const [showRecorder, setShowRecorder] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setReadyVoiceId(providerVoiceId);
  }, [providerVoiceId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function handleConsent() {
    if (!consentChecked) return;
    setConsentPending(true);
    setConsentError(null);
    const result = await confirmVoiceConsent();
    setConsentPending(false);
    if (result.error) {
      setConsentError(result.error);
      return;
    }
    router.refresh();
  }

  async function startRecording() {
    setRecordError(null);
    setAudioBlob(null);
    setElapsedSec(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudioBlob(blob);
        setRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };

      recorder.start(1000);
      setRecording(true);
      timerRef.current = setInterval(() => {
        setElapsedSec((current) => {
          const next = current + 1;
          if (next >= VOICE_SAMPLE_TARGET_SEC) {
            mediaRecorderRef.current?.stop();
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "microphone access denied");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  async function handleSubmitSample() {
    if (!audioBlob) return;
    if (elapsedSec < VOICE_SAMPLE_MIN_SEC) {
      setSubmitError(`Record at least ${VOICE_SAMPLE_MIN_SEC} seconds before submitting.`);
      return;
    }

    setSubmitPending(true);
    setSubmitError(null);
    const formData = new FormData();
    formData.append("audio", audioBlob, "voice-sample.webm");
    formData.append("duration_sec", String(elapsedSec));

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        body: formData,
      });
      const body: { error?: string; provider_voice_id?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        setSubmitError(body.error ?? response.statusText ?? "upload failed");
        return;
      }

      if (body.provider_voice_id) {
        setReadyVoiceId(body.provider_voice_id);
        setShowRecorder(false);
      }
      router.refresh();
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : "upload failed");
    } finally {
      setSubmitPending(false);
    }
  }

  async function handleRetryStored() {
    setSubmitPending(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/voice", { method: "PATCH" });
      const body: { error?: string; provider_voice_id?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        setSubmitError(body.error ?? response.statusText ?? "retry failed");
        return;
      }

      if (body.provider_voice_id) {
        setReadyVoiceId(body.provider_voice_id);
        setShowRecorder(false);
      }
      router.refresh();
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : "retry failed");
    } finally {
      setSubmitPending(false);
    }
  }

  if (readyVoiceId && !showRecorder) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-green-800">Your voice clone is ready.</p>
        <p className="text-sm text-neutral-700">
          ElevenLabs voice ID:{" "}
          <code className="rounded bg-neutral-100 px-1 font-mono text-xs">{readyVoiceId}</code>
        </p>
        <button
          type="button"
          onClick={() => {
            setShowRecorder(true);
            setSubmitError(null);
            setAudioBlob(null);
            setElapsedSec(0);
          }}
          className="rounded border border-neutral-300 px-4 py-2 text-sm"
        >
          Record a new sample
        </button>
      </div>
    );
  }

  if (!consentConfirmed) {
    return (
      <div className="space-y-4">
        <div className="space-y-2 text-sm text-neutral-700">
          <p>
            PhaseShift clones only your own voice for your account. Samples are recorded in-app —
            no file uploads.
          </p>
          <p>
            By continuing, you confirm this is your voice and you consent to voice cloning for
            personal guided sessions only.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(event) => setConsentChecked(event.target.checked)}
            className="mt-1"
          />
          I confirm this is my own voice and I consent to in-app cloning for my account.
        </label>
        {consentError ? <p className="text-sm text-red-700">{consentError}</p> : null}
        <button
          type="button"
          disabled={!consentChecked || consentPending}
          onClick={() => void handleConsent()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {consentPending ? "Saving…" : "Accept and continue"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {status === "failed" ? (
        <p className="text-sm text-red-700">
          Your last clone attempt failed. Record a new sample below or retry from your stored
          recording.
        </p>
      ) : null}

      {canRetryStoredSample ? (
        <button
          type="button"
          disabled={submitPending}
          onClick={() => void handleRetryStored()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitPending ? "Retrying…" : "Retry from stored sample"}
        </button>
      ) : null}

      <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed">
        {VOICE_CLONE_READING_PASSAGE}
      </div>

      <p className="text-sm text-neutral-600">
        Target ~{VOICE_SAMPLE_TARGET_SEC}s of clear speech (minimum {VOICE_SAMPLE_MIN_SEC}s).
      </p>

      <p className="font-mono text-sm">
        {elapsedSec}s / {VOICE_SAMPLE_TARGET_SEC}s
      </p>

      {recordError ? <p className="text-sm text-red-700">{recordError}</p> : null}

      <div className="flex flex-wrap gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            {audioBlob ? "Re-record" : "Start recording"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded border border-neutral-300 px-4 py-2 text-sm"
          >
            Stop recording
          </button>
        )}
        {audioBlob && !recording ? (
          <button
            type="button"
            disabled={submitPending}
            onClick={() => void handleSubmitSample()}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitPending ? "Cloning…" : "Submit voice sample"}
          </button>
        ) : null}
      </div>

      {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}

      {status === "pending" && !audioBlob ? (
        <p className="text-xs text-neutral-500">Status: pending clone</p>
      ) : null}
    </div>
  );
}
