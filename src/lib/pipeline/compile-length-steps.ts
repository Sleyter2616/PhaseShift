import {
  LENGTH_EXPAND_SUFFIX,
  type CompileManifestOptions,
  compileManifestWithBudget,
  CompileStepTimeoutError,
  CompilerError,
} from "../compiler/compile";
import {
  estimateManifestWallClockSec,
  formatLengthExpandRetryMessage,
  isCompileEstimateUnderfilled,
  MAX_PIPELINE_LENGTH_EXPAND_ATTEMPTS,
} from "../compiler/estimate-duration";
import type { Manifest } from "../contracts/manifest";
import { compilerInputForModel, type CompilerInput } from "../session/derive";

export type CompileLengthCheck = {
  estimatedSec: number;
  targetSec: number;
  underfilled: boolean;
  /** Present when underfilled — feed to compile-attempt-2 as initialUserMessage. */
  expandUserMessage: string | null;
};

/**
 * Cheap (no LLM) length assessment after compile-attempt-1.
 * Decides whether the pipeline should schedule compile-attempt-2.
 */
export function assessCompileLength(
  manifest: Manifest,
  compilerInput: CompilerInput,
): CompileLengthCheck {
  const estimatedSec = estimateManifestWallClockSec(manifest);
  const targetSec = manifest.meta.total_duration_sec;
  const underfilled = isCompileEstimateUnderfilled(estimatedSec, targetSec);

  if (!underfilled) {
    return { estimatedSec, targetSec, underfilled: false, expandUserMessage: null };
  }

  const expandBody = formatLengthExpandRetryMessage({
    estimatedSec,
    targetSec,
    thetaSteps: compilerInput.skeleton.theta_steps,
    segments: manifest.segments,
  });

  return {
    estimatedSec,
    targetSec,
    underfilled: true,
    expandUserMessage: `${JSON.stringify(compilerInputForModel(compilerInput))}\n\n${expandBody}${LENGTH_EXPAND_SUFFIX}`,
  };
}

/** Whether the pipeline should run a separate expand compile step. */
export function shouldRunCompileAttempt2(
  check: CompileLengthCheck,
  expandAttemptsAllowed: number = MAX_PIPELINE_LENGTH_EXPAND_ATTEMPTS,
): boolean {
  return expandAttemptsAllowed >= 1 && check.underfilled && check.expandUserMessage != null;
}

/**
 * Fail-open: prefer attempt-2 when present; otherwise keep attempt-1.
 * Never returns null — a playable session always wins over a hang.
 */
export function resolveCompileFailOpen(args: {
  attempt1: Manifest;
  attempt2: Manifest | null;
}): Manifest {
  return args.attempt2 ?? args.attempt1;
}

/**
 * Run expand compile for attempt-2. On timeout or compiler failure, returns
 * null so the caller can fail-open to attempt-1.
 */
export async function runCompileAttempt2FailOpen(
  compilerInput: CompilerInput,
  expandUserMessage: string,
  options?: Omit<CompileManifestOptions, "initialUserMessage">,
): Promise<Manifest | null> {
  try {
    return await compileManifestWithBudget(compilerInput, {
      ...options,
      initialUserMessage: expandUserMessage,
    });
  } catch (error) {
    if (error instanceof CompileStepTimeoutError || error instanceof CompilerError) {
      console.error(
        `compile-attempt-2 fail-open: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return null;
    }
    throw error;
  }
}
