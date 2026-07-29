import Anthropic from "@anthropic-ai/sdk";
import { spliceCountedSequenceSegments } from "../compiler/counted-sequence-segments";
import { injectServerOwnedFields } from "../compiler/inject-server-fields";
import { normalizeManifest } from "../compiler/normalize";
import {
  applySpeakableOutputNormalization,
  logSpeakableOutputChanges,
} from "./speakable-output";
import { COMPILER_PROMPT_V1_4, PROMPT_VERSION as PROMPT_VERSION_V1_4 } from "../compiler/prompt.v1.4";
import {
  COMPILER_PROMPT_V2,
  PROMPT_VERSION as PROMPT_VERSION_V2,
} from "../compiler/prompt.v2";
import {
  COMPILER_PROMPT_V2_1,
  PROMPT_VERSION as PROMPT_VERSION_V2_1,
} from "../compiler/prompt.v2.1";
import {
  COMPILER_PROMPT_V2_2,
  PROMPT_VERSION as PROMPT_VERSION_V2_2,
} from "../compiler/prompt.v2.2";
import {
  COMPILER_PROMPT_V2_3,
  PROMPT_VERSION as PROMPT_VERSION_V2_3,
} from "../compiler/prompt.v2.3";
import {
  COMPILER_PROMPT_V2_4,
  PROMPT_VERSION as PROMPT_VERSION_V2_4,
} from "../compiler/prompt.v2.4";
import {
  COMPILER_PROMPT_V2_5,
  PROMPT_VERSION as PROMPT_VERSION_V2_5,
} from "../compiler/prompt.v2.5";
import { stripCodeFences } from "../compiler/strip-fences";
import {
  estimateManifestWallClockSec,
  formatLengthExpandRetryMessage,
  isCompileEstimateUnderfilled,
  logCompileLengthTelemetry,
  MAX_LENGTH_EXPAND_RETRIES,
  summarizeThetaWordShortfalls,
} from "./estimate-duration";
import { logScriptQaFindings, runScriptQa } from "./script-qa";
import { validateManifest, type Manifest } from "../contracts/manifest";
import { compilerInputForModel, type CompilerInput } from "../session/derive";

export type CompileMessageClient = Pick<Anthropic, "messages">;

export interface CompileAttemptInfo {
  attempt: number;
  validationErrors: string[];
  validationWarnings: string[];
  normalizeActions: string[];
}

export class CompilerError extends Error {
  constructor(
    message: string,
    readonly validationErrors?: string[],
    readonly rawResponse?: string,
    readonly attempts?: CompileAttemptInfo[],
  ) {
    super(message);
    this.name = "CompilerError";
  }
}

export function formatCompilerFailureMessage(error: CompilerError): string {
  const detail = error.validationErrors?.length
    ? `${error.message}: ${error.validationErrors.join(" | ")}`
    : error.message;
  return detail.slice(0, 4000);
}

const RETRY_SUFFIX =
  "\n\nRe-emit ONLY the corrected JSON object. No explanation. No word counts.\nWhen fixing text-level errors, do not change any target_duration_sec value or the segment structure.";

const LENGTH_EXPAND_SUFFIX =
  "\n\nRe-emit ONLY the corrected JSON object. Expand underfilled theta steps to at least each step's target_words minimum with denser sensory detail. Do not add steps. Keep target_duration_sec values and segment/step structure unchanged.";

function logCompileAttempt(
  attempt: number,
  response: Pick<Anthropic.Message, "stop_reason" | "usage">,
): void {
  console.error(
    `compile attempt=${attempt} stop_reason=${response.stop_reason} in=${response.usage?.input_tokens ?? "?"} out=${response.usage?.output_tokens ?? "?"}`,
  );
}

export type CompilerPromptVersion =
  | "v1.4"
  | "v2.0"
  | "v2.1"
  | "v2.2"
  | "v2.3"
  | "v2.4"
  | "v2.5";

/** Default v2.5; set COMPILER_PROMPT_VERSION to pin an older prompt. */
export function resolveCompilerPromptVersion(
  override?: CompilerPromptVersion,
): CompilerPromptVersion {
  if (override) return override;
  const env = process.env.COMPILER_PROMPT_VERSION?.trim();
  if (env === "v1.4") return "v1.4";
  if (env === "v2.0") return "v2.0";
  if (env === "v2.1") return "v2.1";
  if (env === "v2.2") return "v2.2";
  if (env === "v2.3") return "v2.3";
  if (env === "v2.4") return "v2.4";
  return "v2.5";
}

function promptForVersion(version: CompilerPromptVersion): {
  system: string;
  promptVersion: string;
} {
  if (version === "v1.4") {
    return { system: COMPILER_PROMPT_V1_4, promptVersion: PROMPT_VERSION_V1_4 };
  }
  if (version === "v2.0") {
    return { system: COMPILER_PROMPT_V2, promptVersion: PROMPT_VERSION_V2 };
  }
  if (version === "v2.1") {
    return { system: COMPILER_PROMPT_V2_1, promptVersion: PROMPT_VERSION_V2_1 };
  }
  if (version === "v2.2") {
    return { system: COMPILER_PROMPT_V2_2, promptVersion: PROMPT_VERSION_V2_2 };
  }
  if (version === "v2.3") {
    return { system: COMPILER_PROMPT_V2_3, promptVersion: PROMPT_VERSION_V2_3 };
  }
  if (version === "v2.4") {
    return { system: COMPILER_PROMPT_V2_4, promptVersion: PROMPT_VERSION_V2_4 };
  }
  return { system: COMPILER_PROMPT_V2_5, promptVersion: PROMPT_VERSION_V2_5 };
}

export async function compileManifest(
  compilerInput: CompilerInput,
  options?: {
    client?: CompileMessageClient;
    onAttempt?: (info: CompileAttemptInfo) => void;
    promptVersion?: CompilerPromptVersion;
  },
): Promise<Manifest> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !options?.client) {
    throw new CompilerError("ANTHROPIC_API_KEY is not set");
  }

  const model = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
  const client = options?.client ?? new Anthropic({ apiKey: apiKey! });
  const version = resolveCompilerPromptVersion(options?.promptVersion);
  const { system } = promptForVersion(version);
  const expectedThetaSteps = compilerInput.skeleton.steps;

  let userMessage = JSON.stringify(compilerInputForModel(compilerInput));
  let lastErrors: string[] = [];
  let lastRawText = "";
  const attempts: CompileAttemptInfo[] = [];
  let lengthExpandRetries = 0;
  let validationRetryUsed = false;
  // Room for: initial + 1 validation retry + up to 2 length expands.
  const maxAttempts = 1 + 1 + MAX_LENGTH_EXPAND_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: userMessage }],
    });

    logCompileAttempt(attempt + 1, response);

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    lastRawText = text;

    let parsed: unknown;
    let normalizeActions: string[] = [];
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      lastErrors = ["response was not valid JSON"];
      const attemptInfo = {
        attempt: attempt + 1,
        validationErrors: lastErrors,
        validationWarnings: [],
        normalizeActions,
      };
      attempts.push(attemptInfo);
      options?.onAttempt?.(attemptInfo);
      if (validationRetryUsed) break;
      validationRetryUsed = true;
      userMessage = `${JSON.stringify(compilerInputForModel(compilerInput))}\n\nVALIDATOR ERRORS (fix and re-emit):\n${lastErrors.join("\n")}${RETRY_SUFFIX}`;
      continue;
    }

    const injected = injectServerOwnedFields(parsed, compilerInput);
    for (const action of injected.actions) {
      console.error(`inject: ${action}`);
    }

    const spliced = spliceCountedSequenceSegments(injected.manifest, compilerInput);
    for (const action of spliced.actions) {
      console.error(`counted-seq: ${action}`);
    }

    const normalized = normalizeManifest(spliced.manifest);
    normalizeActions = [...injected.actions, ...spliced.actions, ...normalized.actions];
    for (const action of normalized.actions) {
      console.error(`normalize: ${action}`);
    }

    const result = validateManifest(normalized.manifest, { expectedThetaSteps });
    if (result.ok) {
      for (const warning of result.warnings) {
        console.error(`validate: ${warning}`);
      }

      if (result.data.meta.goal_version_id !== compilerInput.goal_version_id) {
        lastErrors = [
          `meta.goal_version_id mismatch: expected ${compilerInput.goal_version_id}, got ${result.data.meta.goal_version_id}`,
        ];
      } else {
        const estimatedSec = estimateManifestWallClockSec(result.data);
        const targetSec = result.data.meta.total_duration_sec;
        const shortfalls = summarizeThetaWordShortfalls(
          compilerInput.skeleton.theta_steps,
          result.data.segments,
        );
        const underfilled = isCompileEstimateUnderfilled(estimatedSec, targetSec);

        if (underfilled && lengthExpandRetries < MAX_LENGTH_EXPAND_RETRIES) {
          logCompileLengthTelemetry({
            estimatedSec,
            targetSec,
            attempt: attempt + 1,
            lengthExpandRetries,
            shortfalls,
            accepting: false,
          });
          const expandMessage = formatLengthExpandRetryMessage({
            estimatedSec,
            targetSec,
            thetaSteps: compilerInput.skeleton.theta_steps,
            segments: result.data.segments,
          });
          lastErrors = [
            `compile length estimate ${estimatedSec.toFixed(1)}s < 97% of target ${targetSec}s`,
          ];
          console.error(`length-gate: ${lastErrors[0]} (expand ${lengthExpandRetries + 1}/${MAX_LENGTH_EXPAND_RETRIES})`);
          const attemptInfo = {
            attempt: attempt + 1,
            validationErrors: lastErrors,
            validationWarnings: result.warnings,
            normalizeActions,
          };
          attempts.push(attemptInfo);
          options?.onAttempt?.(attemptInfo);
          lengthExpandRetries += 1;
          userMessage = `${JSON.stringify(compilerInputForModel(compilerInput))}\n\n${expandMessage}${LENGTH_EXPAND_SUFFIX}`;
          continue;
        }

        logCompileLengthTelemetry({
          estimatedSec,
          targetSec,
          attempt: attempt + 1,
          lengthExpandRetries,
          shortfalls,
          accepting: true,
        });
        if (underfilled) {
          console.error(
            `length-gate: accepting underfill after ${lengthExpandRetries} expand retries; post-synth dwelling will fine-tune`,
          );
        }

        const attemptInfo = {
          attempt: attempt + 1,
          validationErrors: [],
          validationWarnings: result.warnings,
          normalizeActions,
        };
        attempts.push(attemptInfo);
        options?.onAttempt?.(attemptInfo);
        const speakable = applySpeakableOutputNormalization(result.data);
        logSpeakableOutputChanges(speakable.changes);
        const qa = runScriptQa(speakable.manifest);
        logScriptQaFindings(qa.findings);
        return qa.manifest;
      }
    } else {
      lastErrors = result.errors;
    }

    const attemptInfo = {
      attempt: attempt + 1,
      validationErrors: lastErrors,
      validationWarnings: [],
      normalizeActions,
    };
    attempts.push(attemptInfo);
    options?.onAttempt?.(attemptInfo);

    if (validationRetryUsed) break;
    validationRetryUsed = true;
    userMessage = `${JSON.stringify(compilerInputForModel(compilerInput))}\n\nVALIDATOR ERRORS (fix and re-emit):\n${lastErrors.join("\n")}${RETRY_SUFFIX}`;
  }

  throw new CompilerError(
    "manifest validation failed after retry",
    lastErrors,
    lastRawText,
    attempts,
  );
}

export const PROMPT_VERSION = PROMPT_VERSION_V2_5;
export {
  PROMPT_VERSION_V1_4,
  PROMPT_VERSION_V2,
  PROMPT_VERSION_V2_1,
  PROMPT_VERSION_V2_2,
  PROMPT_VERSION_V2_3,
  PROMPT_VERSION_V2_4,
  PROMPT_VERSION_V2_5,
};
