import { stripBreaks } from "./breaks";
import type { SynthesisRequest, SynthesisResult, TTSProvider } from "./provider";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const DEFAULT_WPM = 130;

export class MockTTSProvider implements TTSProvider {
  readonly id = "selfhost" as const;
  readonly supportsInlineBreaks = false;

  constructor(private readonly wpm: number = DEFAULT_WPM) {}

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const { cleanText, totalBreakMs } = stripBreaks(req.text);
    const words = countWords(cleanText);
    const durationSec = (words / this.wpm) * 60 + totalBreakMs / 1000;
    return {
      audio: new Uint8Array(0),
      durationSec,
      requestId: `mock-${req.voiceId}-${words}`,
    };
  }
}
