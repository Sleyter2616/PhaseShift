import type { SynthesisRequest, SynthesisResult, TTSProvider } from "./provider";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const DEFAULT_WPM = 130;

export class MockTTSProvider implements TTSProvider {
  constructor(private readonly wpm: number = DEFAULT_WPM) {}

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const words = countWords(req.text);
    const durationSec = (words / this.wpm) * 60;
    return {
      audio: new Uint8Array(0),
      durationSec,
      requestId: `mock-${req.voiceId}-${words}`,
    };
  }
}
