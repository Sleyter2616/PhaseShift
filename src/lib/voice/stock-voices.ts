export type StockVoiceOption = {
  id: string;
  label: string;
  key: "male" | "female" | "default";
};

type EnvLike = Record<string, string | undefined>;

/** Prefer gendered stock voices; fall back to legacy ELEVENLABS_STOCK_VOICE_ID. */
export function stockVoiceOptionsFromEnv(env: EnvLike = process.env): StockVoiceOption[] {
  const male = env.ELEVENLABS_STOCK_VOICE_MALE?.trim();
  const female = env.ELEVENLABS_STOCK_VOICE_FEMALE?.trim();
  const fallback = env.ELEVENLABS_STOCK_VOICE_ID?.trim();
  const options: StockVoiceOption[] = [];
  if (male) options.push({ id: male, label: "Stock voice (male)", key: "male" });
  if (female) options.push({ id: female, label: "Stock voice (female)", key: "female" });
  if (options.length === 0 && fallback) {
    options.push({ id: fallback, label: "Stock voice", key: "default" });
  }
  return options;
}

export function isAllowedStockVoiceId(voiceId: string, env: EnvLike = process.env): boolean {
  return stockVoiceOptionsFromEnv(env).some((option) => option.id === voiceId);
}

export function defaultStockVoiceId(env: EnvLike = process.env): string | null {
  return stockVoiceOptionsFromEnv(env)[0]?.id ?? null;
}
