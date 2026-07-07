export type TtsProviderId =
  | "elevenlabs"
  | "openai"
  | "google"
  | "amazon"
  | "inworld"
  | "minimax"
  | "selfhost";

export interface SynthesisRequest {
  text: string;
  voiceId: string;
  modelId: string;
  settings: Record<string, unknown>;
  previousText?: string;
  nextText?: string;
}

export interface SynthesisResult {
  audio: Uint8Array;
  durationSec: number;
  requestId?: string;
}

export interface TTSProvider {
  readonly id: TtsProviderId;
  readonly supportsInlineBreaks: boolean;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
}
