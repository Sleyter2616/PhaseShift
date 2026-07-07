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
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
}
