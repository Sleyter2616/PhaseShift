export const VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_SAMPLE_MIN_DURATION_SEC = 60;

export function voiceSampleStoragePath(userId: string): string {
  return `${userId}/voice-sample.webm`;
}

export function validateVoiceSampleUpload(input: {
  byteLength: number;
  durationSec?: number | null;
}): string | null {
  if (input.byteLength <= 0) {
    return "missing audio sample";
  }
  if (input.byteLength > VOICE_SAMPLE_MAX_BYTES) {
    return "audio sample exceeds 10MB limit";
  }
  if (
    input.durationSec != null &&
    !Number.isNaN(input.durationSec) &&
    input.durationSec < VOICE_SAMPLE_MIN_DURATION_SEC
  ) {
    return `recording too short (${input.durationSec}s); minimum ${VOICE_SAMPLE_MIN_DURATION_SEC}s`;
  }
  return null;
}

export function parseDurationSecField(raw: FormDataEntryValue | null): number | null {
  if (raw == null || raw === "") return null;
  const value = typeof raw === "string" ? Number(raw) : Number(raw);
  if (Number.isNaN(value)) return Number.NaN;
  return value;
}
