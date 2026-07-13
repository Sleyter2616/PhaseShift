import { CREDIT_CHAR_CAP_FLASH, CREDITS_PER_V2_GENERATION } from "../costs";
import { DEFAULT_VOICE_SETTINGS } from "../pipeline/synthesis-identity";

export const TTS_MATRIX_MODELS = ["eleven_flash_v2_5", "eleven_multilingual_v2"] as const;

export type TtsMatrixModelId = (typeof TTS_MATRIX_MODELS)[number];

export const TTS_MATRIX_PRESET_NAMES = [
  "default",
  "high-similarity",
  "max-similarity",
] as const;

export type TtsMatrixPresetName = (typeof TTS_MATRIX_PRESET_NAMES)[number];

export const TTS_MATRIX_PRESETS: Record<
  TtsMatrixPresetName,
  { settings: Record<string, unknown> }
> = {
  default: { settings: DEFAULT_VOICE_SETTINGS },
  "high-similarity": { settings: { similarity_boost: 0.9, stability: 0.4 } },
  "max-similarity": { settings: { similarity_boost: 1.0, stability: 0.3 } },
};

export interface TtsMatrixRun {
  filename: string;
  modelId: TtsMatrixModelId;
  preset: TtsMatrixPresetName;
  settings: Record<string, unknown>;
}

export function matrixFilename(modelId: string, preset: string): string {
  return `${modelId}__${preset}.mp3`;
}

export function buildTtsMatrixPlan(): TtsMatrixRun[] {
  const runs: TtsMatrixRun[] = [];
  for (const modelId of TTS_MATRIX_MODELS) {
    for (const preset of TTS_MATRIX_PRESET_NAMES) {
      runs.push({
        filename: matrixFilename(modelId, preset),
        modelId,
        preset,
        settings: TTS_MATRIX_PRESETS[preset].settings,
      });
    }
  }
  return runs;
}

export function creditsForMatrixSynthesis(modelId: string, billableChars: number): number {
  if (modelId === "eleven_multilingual_v2") {
    return CREDITS_PER_V2_GENERATION;
  }
  return billableChars <= CREDIT_CHAR_CAP_FLASH
    ? 1
    : Math.ceil(billableChars / CREDIT_CHAR_CAP_FLASH);
}

export function estimateMatrixCreditCost(billableChars: number): number {
  return buildTtsMatrixPlan().reduce(
    (sum, run) => sum + creditsForMatrixSynthesis(run.modelId, billableChars),
    0,
  );
}

export function formatMatrixSettings(settings: Record<string, unknown>): string {
  return Object.entries(settings)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}
