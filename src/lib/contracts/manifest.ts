import { z } from "zod";

const phaseEnum = z.enum(["beta", "alpha", "theta", "gamma", "delta"]);
const perspectiveEnum = z.enum(["first", "second", "third"]);
const horizonEnum = z.enum(["introspective", "retrospective", "protospective"]);
const archetypeEnum = z.enum([
  "child",
  "trickster",
  "warrior",
  "thief",
  "magician",
  "creator",
]);

const phaseBudgetSchema = z.object({
  beta: z.number().int().positive(),
  alpha: z.number().int().positive(),
  theta: z.number().int().positive(),
  gamma: z.number().int().positive(),
});

const entrainmentPlanItemSchema = z.object({
  phase: phaseEnum,
  hz: z.number(),
  glide_to: z.number().nullable().optional(),
  glide_sec: z.number().optional(),
});

const segmentSchema = z.object({
  seq: z.number().int().positive(),
  phase: phaseEnum,
  step: z.number().int().min(1).max(12).nullable(),
  title: z.string().optional(),
  perspective: perspectiveEnum.nullable().optional(),
  temporal_horizon: horizonEnum.nullable().optional(),
  archetype: archetypeEnum.nullable().optional(),
  pacing_wpm: z.number().int().positive(),
  target_duration_sec: z.number().int().positive(),
  pause_after_ms: z.number().int().nonnegative(),
  text: z.string().min(1),
});

const manifestSchema = z.object({
  meta: z.object({
    goal_version_id: z.string().uuid(),
    total_duration_sec: z.number().int().positive(),
    phase_budget_sec: phaseBudgetSchema,
    entrainment_plan: z.array(entrainmentPlanItemSchema),
  }),
  segments: z.array(segmentSchema).min(1),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestSegment = z.infer<typeof segmentSchema>;

const BREAK_TAG_REGEX = /<break\s+time="(\d+(?:\.\d+)?)s"\s*\/>/gi;
const PHASES = ["beta", "alpha", "theta", "gamma"] as const;

function countWords(text: string): number {
  const stripped = text.replace(BREAK_TAG_REGEX, " ");
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function maxBreakSeconds(text: string): number {
  let max = 0;
  for (const match of text.matchAll(BREAK_TAG_REGEX)) {
    const val = Number(match[1]);
    if (!Number.isNaN(val) && val > max) max = val;
  }
  return max;
}

function collectRefinementErrors(manifest: Manifest): string[] {
  const errors: string[] = [];

  for (const phase of PHASES) {
    const budget = manifest.meta.phase_budget_sec[phase];
    const phaseSegments = manifest.segments.filter((s) => s.phase === phase);
    const sumDuration = phaseSegments.reduce((acc, s) => acc + s.target_duration_sec, 0);
    if (sumDuration !== budget) {
      errors.push(
        `phase ${phase}: sum of target_duration_sec (${sumDuration}) !== phase_budget_sec (${budget})`,
      );
    }
  }

  for (const segment of manifest.segments) {
    const maxBreak = maxBreakSeconds(segment.text);
    if (maxBreak > 3.0) {
      errors.push(
        `segment seq ${segment.seq}: break tag exceeds 3.0s maximum (${maxBreak}s)`,
      );
    }

    const wordBudget = (segment.pacing_wpm * segment.target_duration_sec) / 60;
    const words = countWords(segment.text);
    if (words > wordBudget) {
      errors.push(
        `segment seq ${segment.seq}: word count ${words} exceeds budget ${wordBudget.toFixed(1)} (pacing_wpm ${segment.pacing_wpm} × ${segment.target_duration_sec}s / 60)`,
      );
    }

    if (segment.phase !== "theta" && segment.step !== null && segment.step !== undefined) {
      errors.push(`segment seq ${segment.seq}: step must be null outside theta phase`);
    }
  }

  const thetaSegments = manifest.segments
    .filter((s) => s.phase === "theta")
    .sort((a, b) => a.seq - b.seq);

  const thetaSteps = thetaSegments
    .map((s) => s.step)
    .filter((step): step is number => step !== null && step !== undefined);

  for (let step = 1; step <= 12; step++) {
    const count = thetaSteps.filter((s) => s === step).length;
    if (count < 1) {
      errors.push(`theta phase missing at least one segment for step ${step}`);
    }
  }

  const orderedUniqueSteps: number[] = [];
  for (const seg of thetaSegments) {
    if (seg.step === null || seg.step === undefined) {
      errors.push(`segment seq ${seg.seq}: theta segment missing step`);
      continue;
    }
    if (orderedUniqueSteps.length === 0 || orderedUniqueSteps.at(-1) !== seg.step) {
      orderedUniqueSteps.push(seg.step);
    }
  }

  const expectedOrder = Array.from({ length: 12 }, (_, i) => i + 1);
  if (orderedUniqueSteps.join(",") !== expectedOrder.join(",")) {
    errors.push(
      `theta steps must appear in order 1..12; got unique step order [${orderedUniqueSteps.join(", ")}]`,
    );
  }

  return errors;
}

export type ManifestValidationResult =
  | { ok: true; data: Manifest }
  | { ok: false; errors: string[] };

export function validateManifest(json: unknown): ManifestValidationResult {
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    });
    return { ok: false, errors };
  }

  const refinementErrors = collectRefinementErrors(parsed.data);
  if (refinementErrors.length > 0) {
    return { ok: false, errors: refinementErrors };
  }

  return { ok: true, data: parsed.data };
}

export { manifestSchema, phaseEnum, perspectiveEnum, horizonEnum, archetypeEnum };
