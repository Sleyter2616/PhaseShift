import { createHash } from "node:crypto";

export type AssetScope = "user" | "shared";

export interface DedupeKeyInput {
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
 * dedupe_key = sha256(`${asset_scope}|${voice_id}|${model_id}|${canonical_settings_json}|${text}`)
 * Amendment A1: scope included per §1.4 DDL comment.
 */
export function dedupeKey(input: DedupeKeyInput): string {
  const canonical = canonicalizeSettings(input.settings);
  const payload = `${input.assetScope}|${input.voiceId}|${input.modelId}|${canonical}|${input.text}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
