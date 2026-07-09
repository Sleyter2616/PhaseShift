import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { ElevenLabsProvider } from "../src/lib/tts/elevenlabs";
import { TTS_SAMPLE_EXCERPT } from "../src/lib/tts/sample-excerpt";
import { stripBreaks } from "../src/lib/tts/breaks";
import { PROVIDER_PRICING_USD_PER_1M_CHARS } from "../src/lib/costs";
import { DEFAULT_VOICE_SETTINGS } from "../src/lib/pipeline/synthesis-identity";

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const voiceId = process.argv[2];
  const modelId = process.argv[3] ?? process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

  if (!voiceId) {
    console.error("Usage: pnpm tts:sample <voiceId> [modelId]");
    process.exit(1);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set");
    process.exit(1);
  }

  const provider = new ElevenLabsProvider(apiKey);
  const result = await provider.synthesize({
    text: TTS_SAMPLE_EXCERPT,
    voiceId,
    modelId,
    settings: DEFAULT_VOICE_SETTINGS,
  });

  const samplesDir = resolve(process.cwd(), "samples");
  mkdirSync(samplesDir, { recursive: true });
  const outPath = resolve(samplesDir, `${voiceId}-${modelId}.mp3`);
  writeFileSync(outPath, result.audio);

  const { cleanText } = stripBreaks(TTS_SAMPLE_EXCERPT);
  const billableChars = cleanText.length;
  const pricing = PROVIDER_PRICING_USD_PER_1M_CHARS.elevenlabs;
  const estimatedCostUsd = (billableChars / 1_000_000) * pricing.high;

  console.log(`wrote ${outPath}`);
  console.log(`duration_sec=${result.durationSec.toFixed(2)}`);
  console.log(`billable_chars=${billableChars}`);
  console.log(`bytes=${result.audio.byteLength}`);
  console.log(`estimated_cost_usd≈${estimatedCostUsd.toFixed(4)} (indicative high)`);
  if (result.requestId) console.log(`request_id=${result.requestId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
