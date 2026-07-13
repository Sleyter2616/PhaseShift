import { CompilerError, compileManifest } from "../src/lib/compiler/compile";
import { stripBreaks } from "../src/lib/tts/breaks";
import { PHASES } from "../src/lib/schedule/reconcile";
import { intake40Min } from "../src/lib/fixtures/intake";
import { buildCompilerInput } from "../src/lib/session/derive";
import { formatScriptDump, type DumpSegment } from "../src/lib/review/script-dump";
import { loadEnvLocal } from "./load-env";

const GOAL_VERSION_ID = "550e8400-e29b-41d4-a716-446655440000";

function countWords(text: string): number {
  const { cleanText } = stripBreaks(text);
  return cleanText.trim().split(/\s+/).filter(Boolean).length;
}

function manifestSegmentsToDump(segments: {
  seq: number;
  phase: string;
  step: number | null;
  title?: string;
  pacing_wpm: number;
  target_duration_sec: number;
  pause_after_ms: number;
  text: string;
}[]): DumpSegment[] {
  return segments.map((segment) => ({
    seq: segment.seq,
    phase: segment.phase,
    step: segment.step,
    title: segment.title ?? null,
    pacing_wpm: segment.pacing_wpm,
    target_duration_sec: segment.target_duration_sec,
    pause_after_ms: segment.pause_after_ms,
    text: segment.text,
  }));
}

async function main() {
  loadEnvLocal();
  const fullDump = process.argv.includes("--full");

  const input = buildCompilerInput(intake40Min, GOAL_VERSION_ID);

  try {
    const manifest = await compileManifest(input, {
      onAttempt: ({ attempt, validationErrors, validationWarnings, normalizeActions }) => {
        console.error(`--- attempt ${attempt} ---`);
        if (normalizeActions.length > 0) {
          console.error("normalization:");
          for (const action of normalizeActions) console.error(`  ${action}`);
        }
        if (validationWarnings.length > 0) {
          console.error("validation warnings:");
          for (const warning of validationWarnings) console.error(`  ${warning}`);
        }
        if (validationErrors.length > 0) {
          console.error("validation errors:");
          for (const error of validationErrors) console.error(`  ${error}`);
        }
      },
    });

    if (fullDump) {
      console.log(formatScriptDump(manifestSegmentsToDump(manifest.segments)));
      process.exit(0);
    }

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
          if (attempt.validationWarnings.length > 0) {
            console.error("validation warnings:");
            for (const warning of attempt.validationWarnings) console.error(`  ${warning}`);
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
