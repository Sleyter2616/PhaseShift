import {
  type CompileManifestOptions,
  compileManifestWithBudget,
  CompileStepTimeoutError,
} from "../compiler/compile";
import type { Manifest } from "../contracts/manifest";
import type { CompilerInput } from "../session/derive";

export type CompilePrimaryResult =
  | { status: "ok"; manifest: Manifest; durationMs: number }
  | { status: "timeout"; message: string; durationMs: number };

/**
 * Run one primary compile pass. Soft-budget timeouts are returned as a result
 * so the pipeline can schedule a separate Inngest retry step. Other errors
 * (CompilerError, network) still throw.
 */
export async function runCompilePrimaryAttempt(
  compilerInput: CompilerInput,
  options?: CompileManifestOptions & { budgetMs?: number },
): Promise<CompilePrimaryResult> {
  const started = Date.now();
  try {
    const manifest = await compileManifestWithBudget(compilerInput, options);
    return { status: "ok", manifest, durationMs: Date.now() - started };
  } catch (error) {
    if (error instanceof CompileStepTimeoutError) {
      return {
        status: "timeout",
        message: error.message,
        durationMs: Date.now() - started,
      };
    }
    throw error;
  }
}

/** Soft-budget timeout on attempt-1 → schedule exactly one separate-step retry. */
export function shouldRetryCompileOnTimeout(
  result: CompilePrimaryResult,
): result is Extract<CompilePrimaryResult, { status: "timeout" }> {
  return result.status === "timeout";
}
