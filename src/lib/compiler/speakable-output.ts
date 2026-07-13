import type { Manifest } from "../contracts/manifest";
import { toSpeakableText } from "./speech-normalize";

export interface SpeakableOutputChange {
  seq: number;
  before: string;
  after: string;
}

export function applySpeakableOutputNormalization(manifest: Manifest): {
  manifest: Manifest;
  changes: SpeakableOutputChange[];
} {
  const changes: SpeakableOutputChange[] = [];
  const segments = manifest.segments.map((segment) => {
    const after = toSpeakableText(segment.text);
    if (after !== segment.text) {
      changes.push({ seq: segment.seq, before: segment.text, after });
    }
    return after === segment.text ? segment : { ...segment, text: after };
  });

  return {
    manifest: { ...manifest, segments },
    changes,
  };
}

export function logSpeakableOutputChanges(changes: ReadonlyArray<SpeakableOutputChange>): void {
  for (const change of changes) {
    console.error(`speakable-output: seq ${change.seq} text normalized for TTS`);
  }
}
