import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ElevenLabsProvider } from "../src/lib/tts/elevenlabs";
import { TTS_MATRIX_EXCERPT } from "../src/lib/tts/sample-excerpt";
import {
  buildTtsMatrixPlan,
  estimateMatrixCreditCost,
  formatMatrixSettings,
} from "../src/lib/tts/matrix-config";
import { stripBreaks } from "../src/lib/tts/breaks";
import { loadEnvLocal } from "./load-env";

function printMatrixPlan(billableChars: number): void {
  const plan = buildTtsMatrixPlan();
  const totalCredits = estimateMatrixCreditCost(billableChars);

  console.log("TTS fidelity matrix (same excerpt across model x voice_settings):");
  console.log("");
  console.log(
    ["filename", "model", "preset", "settings"].map((h) => h.padEnd(36)).join(""),
  );
  for (const run of plan) {
    console.log(
      [
        run.filename.padEnd(36),
        run.modelId.padEnd(36),
        run.preset.padEnd(36),
        formatMatrixSettings(run.settings),
      ].join(""),
    );
  }
  console.log("");
  console.log(`billable_chars=${billableChars}`);
  console.log(`estimated_credits=${totalCredits}`);
  console.log("");
  console.log("Re-run with --confirm to synthesize and write ./samples/matrix/");
}

async function main() {
  loadEnvLocal();

  const voiceId = process.argv[2];
  const confirm = process.argv.includes("--confirm");

  if (!voiceId) {
    console.error("Usage: pnpm tts:matrix <voiceId> [--confirm]");
    process.exit(1);
  }

  const { cleanText } = stripBreaks(TTS_MATRIX_EXCERPT);
  const billableChars = cleanText.length;

  if (!confirm) {
    printMatrixPlan(billableChars);
    process.exit(0);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set");
    process.exit(1);
  }

  printMatrixPlan(billableChars);

  const provider = new ElevenLabsProvider(apiKey);
  const outDir = resolve(process.cwd(), "samples/matrix");
  mkdirSync(outDir, { recursive: true });

  for (const run of buildTtsMatrixPlan()) {
    const result = await provider.synthesize({
      text: TTS_MATRIX_EXCERPT,
      voiceId,
      modelId: run.modelId,
      settings: run.settings,
    });
    const outPath = resolve(outDir, run.filename);
    writeFileSync(outPath, result.audio);
    console.log(
      `wrote ${outPath} duration_sec=${result.durationSec.toFixed(2)} bytes=${result.audio.byteLength}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
