export interface ScriptSynthesisSource {
  provider: string;
  stock_voice_id: string | null;
  voice_profile_id: string | null;
}

/** Badge label for /scripts synthesis provenance (Phase 4b.5). */
export function synthesisProvenanceBadge(source: ScriptSynthesisSource): string {
  if (source.provider === "selfhost") {
    return "test audio";
  }
  if (source.voice_profile_id) {
    return "My voice";
  }
  if (source.stock_voice_id) {
    return "Stock voice";
  }
  return source.provider;
}

export function isTestGenerationProvider(provider: string): boolean {
  return provider === "selfhost";
}
