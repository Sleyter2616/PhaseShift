import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CompilerError, compileManifest } from "../src/lib/compiler/compile";
import { stripBreaks } from "../src/lib/tts/breaks";
import { PHASES } from "../src/lib/schedule/reconcile";
import { intake20Min } from "../src/lib/fixtures/intake";
import { buildCompilerInput } from "../src/lib/session/derive";

const GOAL_VERSION_ID = "550e8400-e29b-41d4-a716-446655440000";

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

function countWords(text: string): number {
  const { cleanText } = stripBreaks(text);
  return cleanText.trim().split(/\s+/).filter(Boolean).length;
}

async function main() {
  loadEnvLocal();

  const input = buildCompilerInput(intake20Min, GOAL_VERSION_ID);

  try {
    const manifest = await compileManifest(input, {
      onAttempt: ({ attempt, validationErrors, normalizeActions }) => {
        console.error(`--- attempt ${attempt} ---`);
        if (normalizeActions.length > 0) {
          console.error("normalization:");
          for (const action of normalizeActions) console.error(`  ${action}`);
        }
        if (validationErrors.length > 0) {
          console.error("validation errors:");
          for (const error of validationErrors) console.error(`  ${error}`);
        }
      },
    });
    const phaseBudget = input.session.phase_budget_sec;

    console.log(`segments: ${manifest.segments.length}`);
    for (const phase of PHASES) {
      const phaseSegs = manifest.segments.filter((s) => s.phase === phase);
      const sumDuration = phaseSegs.reduce((a, s) => a + s.target_duration_sec, 0);
      const words = phaseSegs.reduce((a, s) => a + countWords(s.text), 0);
      const wordBudget = phaseSegs.reduce(
        (a, s) => a + (s.pacing_wpm * s.target_duration_sec) / 60,
        0,
      );
      console.log(
        `phase ${phase}: target_duration_sec sum=${sumDuration} budget=${phaseBudget[phase]} | words=${words} wordBudget≈${wordBudget.toFixed(0)}`,
      );
    }
    process.exit(0);
  } catch (error) {
    if (error instanceof CompilerError) {
      if (error.attempts) {
        for (const attempt of error.attempts) {
          console.error(`--- attempt ${attempt.attempt} ---`);
          if (attempt.normalizeActions.length > 0) {
            console.error("normalization:");
            for (const action of attempt.normalizeActions) console.error(`  ${action}`);
          }
          if (attempt.validationErrors.length > 0) {
            console.error("validation errors:");
            for (const line of attempt.validationErrors) console.error(`  ${line}`);
          }
        }
      } else {
        for (const line of error.validationErrors ?? []) {
          console.error(line);
        }
      }
      if (error.rawResponse) {
        console.error("--- rawResponse ---");
        console.error(error.rawResponse);
      }
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
