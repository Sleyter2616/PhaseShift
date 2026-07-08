import Anthropic from "@anthropic-ai/sdk";
import { COMPILER_PROMPT_V1_1, PROMPT_VERSION } from "../compiler/prompt.v1.1";
import { stripCodeFences } from "../compiler/strip-fences";
import { validateManifest, type Manifest } from "../contracts/manifest";
import type { CompilerInput } from "../session/derive";

export type CompileMessageClient = Pick<Anthropic, "messages">;

export class CompilerError extends Error {
  constructor(
    message: string,
    readonly validationErrors?: string[],
    readonly rawResponse?: string,
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

function logCompileAttempt(
  attempt: number,
  response: Pick<Anthropic.Message, "stop_reason" | "usage">,
): void {
  console.error(
    `compile attempt=${attempt} stop_reason=${response.stop_reason} in=${response.usage?.input_tokens ?? "?"} out=${response.usage?.output_tokens ?? "?"}`,
  );
}

export async function compileManifest(
  compilerInput: CompilerInput,
  options?: { client?: CompileMessageClient },
): Promise<Manifest> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !options?.client) {
    throw new CompilerError("ANTHROPIC_API_KEY is not set");
  }

  const model = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
  const client = options?.client ?? new Anthropic({ apiKey: apiKey! });

  let userMessage = JSON.stringify(compilerInput);
  let lastErrors: string[] = [];
  let lastRawText = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      temperature: 0.2,
      system: COMPILER_PROMPT_V1_1,
      messages: [{ role: "user", content: userMessage }],
    });

    logCompileAttempt(attempt + 1, response);

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    lastRawText = text;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      lastErrors = ["response was not valid JSON"];
      if (attempt === 1) break;
      userMessage = `${JSON.stringify(compilerInput)}\n\nVALIDATOR ERRORS (fix and re-emit):\n${lastErrors.join("\n")}`;
      continue;
    }

    const result = validateManifest(parsed);
    if (result.ok) {
      if (result.data.meta.goal_version_id !== compilerInput.goal_version_id) {
        lastErrors = [
          `meta.goal_version_id mismatch: expected ${compilerInput.goal_version_id}, got ${result.data.meta.goal_version_id}`,
        ];
      } else {
        return result.data;
      }
    } else {
      lastErrors = result.errors;
    }

    if (attempt === 0) {
      userMessage = `${JSON.stringify(compilerInput)}\n\nVALIDATOR ERRORS (fix and re-emit):\n${lastErrors.join("\n")}`;
    }
  }

  throw new CompilerError("manifest validation failed after retry", lastErrors, lastRawText);
}

export { PROMPT_VERSION };
