import { ElevenLabsProvider } from "./elevenlabs";
import { MockTTSProvider } from "./mock";
import type { TTSProvider, TtsProviderId } from "./provider";

export function getProvider(id: TtsProviderId, options?: { pacingWpm?: number }): TTSProvider {
  switch (id) {
    case "elevenlabs": {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new Error("ELEVENLABS_API_KEY is not set");
      }
      return new ElevenLabsProvider(apiKey);
    }
    case "selfhost":
      return new MockTTSProvider(options?.pacingWpm);
    default:
      throw new Error(`unsupported TTS provider: ${id}`);
  }
}
