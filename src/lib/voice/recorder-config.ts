export const VOICE_RECORDING_BITS_PER_SECOND = 128_000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

export function pickRecorderMimeType(
  isTypeSupported: (mime: string) => boolean,
): string {
  for (const mime of MIME_CANDIDATES) {
    if (isTypeSupported(mime)) return mime;
  }
  return "";
}

export interface VoiceRecorderOptions {
  mimeType: string;
  audioBitsPerSecond: number;
}

export function buildVoiceRecorderOptions(
  isTypeSupported: (mime: string) => boolean,
): VoiceRecorderOptions {
  return {
    mimeType: pickRecorderMimeType(isTypeSupported),
    audioBitsPerSecond: VOICE_RECORDING_BITS_PER_SECOND,
  };
}
