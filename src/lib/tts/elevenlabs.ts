import type { SynthesisRequest, SynthesisResult, TTSProvider } from "./provider";
import { TTSProviderError } from "./errors";
import { isUuidV4 } from "./voice-id-guard";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

interface ElevenLabsTimestampResponse {
  audio_base64?: string;
  alignment?: {
    character_end_times_seconds?: number[];
  };
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function durationFromAlignment(alignment: ElevenLabsTimestampResponse["alignment"]): number | null {
  const times = alignment?.character_end_times_seconds;
  if (!times || times.length === 0) return null;
  return times[times.length - 1] ?? null;
}

function estimateDurationFromBytes(bytes: number): number {
  return bytes / (128_000 / 8);
}

export class ElevenLabsProvider implements TTSProvider {
  readonly id = "elevenlabs" as const;
  readonly supportsInlineBreaks = true;

  constructor(private readonly apiKey: string) {}

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    if (isUuidV4(req.voiceId)) {
      throw new TTSProviderError("voiceId looks like an internal uuid — wiring bug", false);
    }

    const url = `${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text: req.text,
          model_id: req.modelId,
          voice_settings: req.settings,
          ...(req.previousText ? { previous_text: req.previousText } : {}),
          ...(req.nextText ? { next_text: req.nextText } : {}),
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      throw new TTSProviderError(`elevenlabs network error: ${message}`, true);
    }

    const requestId =
      response.headers.get("request-id") ??
      response.headers.get("x-request-id") ??
      undefined;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TTSProviderError(
        `elevenlabs HTTP ${response.status}: ${body.slice(0, 500)}`,
        isRetriableStatus(response.status),
      );
    }

    let payload: ElevenLabsTimestampResponse;
    try {
      payload = (await response.json()) as ElevenLabsTimestampResponse;
    } catch {
      throw new TTSProviderError("elevenlabs response was not valid JSON", false);
    }

    if (!payload.audio_base64) {
      throw new TTSProviderError("elevenlabs response missing audio_base64", false);
    }

    const audio = Uint8Array.from(Buffer.from(payload.audio_base64, "base64"));
    const alignedDuration = durationFromAlignment(payload.alignment);

    let durationSec: number;
    if (alignedDuration != null) {
      durationSec = alignedDuration;
    } else {
      durationSec = estimateDurationFromBytes(audio.byteLength);
      console.error(
        `elevenlabs: alignment missing; estimated duration ${durationSec.toFixed(2)}s from ${audio.byteLength} bytes`,
      );
    }

    return { audio, durationSec, requestId };
  }
}
