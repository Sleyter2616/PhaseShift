import { createHash } from "node:crypto";
import type { TtsProviderId } from "./provider";

export type AssetScope = "user" | "shared";

export interface DedupeKeyInput {
  provider: TtsProviderId;
  assetScope: AssetScope;
  voiceId: string;
  modelId: string;
  settings: Record<string, unknown>;
  text: string;
}

/** Canonicalize settings via sorted-key JSON (A1 amendment). */
export function canonicalizeSettings(settings: Record<string, unknown>): string {
  const sorted = Object.keys(settings)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = settings[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

/**
 * dedupe_key = sha256(`${provider}|${asset_scope}|${voice_id}|${model_id}|${canonical_settings_json}|${text}`)
 * Amendments A1 (asset_scope) + A3 (provider).
 */
export function dedupeKey(input: DedupeKeyInput): string {
  const canonical = canonicalizeSettings(input.settings);
  const payload = `${input.provider}|${input.assetScope}|${input.voiceId}|${input.modelId}|${canonical}|${input.text}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
