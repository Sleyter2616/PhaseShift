import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ElevenLabsProvider } from "./elevenlabs";
import { TTSProviderError } from "./errors";

const ALIGNMENT_FIXTURE = {
  audio_base64: Buffer.from("fake-mp3-bytes").toString("base64"),
  alignment: {
    character_end_times_seconds: [0.1, 0.5, 1.2, 3.4],
  },
};

describe("ElevenLabsProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts duration from alignment character_end_times_seconds", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(ALIGNMENT_FIXTURE), {
        status: 200,
        headers: { "request-id": "req-123" },
      }),
    );

    const provider = new ElevenLabsProvider("test-key");
    const result = await provider.synthesize({
      text: 'Hello <break time="1.0s"/> world.',
      voiceId: "voice-1",
      modelId: "eleven_flash_v2_5",
      settings: { stability: 0.5 },
      previousText: "before",
      nextText: "after",
    });

    expect(result.durationSec).toBe(3.4);
    expect(result.requestId).toBe("req-123");
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-1/with-timestamps",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "xi-api-key": "test-key" }),
      }),
    );
  });

  it("marks 429 as retriable and 400 as non-retriable", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const provider = new ElevenLabsProvider("test-key");
    await expect(
      provider.synthesize({
        text: "hi",
        voiceId: "v",
        modelId: "m",
        settings: {},
      }),
    ).rejects.toMatchObject({ retriable: true } satisfies Partial<TTSProviderError>);

    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(
      provider.synthesize({
        text: "hi",
        voiceId: "v",
        modelId: "m",
        settings: {},
      }),
    ).rejects.toMatchObject({ retriable: false } satisfies Partial<TTSProviderError>);
  });

  it("passes text through without stripping inline breaks", () => {
    const provider = new ElevenLabsProvider("test-key");
    expect(provider.supportsInlineBreaks).toBe(true);
  });

  it("rejects uuid-shaped voiceId before any network call", async () => {
    const provider = new ElevenLabsProvider("test-key");
    await expect(
      provider.synthesize({
        text: "hi",
        voiceId: "a1b2c3d4-e5f6-4a78-9abc-def012345678",
        modelId: "m",
        settings: {},
      }),
    ).rejects.toMatchObject({
      retriable: false,
      message: "voiceId looks like an internal uuid — wiring bug",
    } satisfies Partial<TTSProviderError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
