import Anthropic from "@anthropic-ai/sdk";
import { COMPILER_PROMPT_V1 } from "../compiler/prompt.v1";
import { stripCodeFences } from "../compiler/strip-fences";
import { validateManifest, type Manifest } from "../contracts/manifest";
import type { CompilerInput } from "../session/derive";

export class CompilerError extends Error {
  constructor(
    message: string,
    readonly validationErrors?: string[],
  ) {
    super(message);
    this.name = "CompilerError";
  }
}

export async function compileManifest(compilerInput: CompilerInput): Promise<Manifest> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CompilerError("ANTHROPIC_API_KEY is not set");
  }

  const model = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey });

  let userMessage = JSON.stringify(compilerInput);
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      temperature: 0.2,
      system: COMPILER_PROMPT_V1,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

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

  throw new CompilerError("manifest validation failed after retry", lastErrors);
}
