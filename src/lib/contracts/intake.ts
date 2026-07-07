import { z } from "zod";

const TIMEFRAME_PRESETS = ["30d", "60d", "90d"] as const;

const ABSTRACT_DENYLIST = new Set([
  "feeling",
  "energy",
  "vibration",
  "universe",
  "manifest",
  "hope",
  "wish",
  "maybe",
  "perhaps",
  "simply",
  "just",
  "success",
  "happiness",
  "abundance",
  "clarity",
  "confidence",
  "peace",
  "growth",
  "mindset",
  "awareness",
]);

const CONCRETE_NOUN_LEXICON = new Set([
  "email",
  "call",
  "meeting",
  "paycheck",
  "handshake",
  "invoice",
  "contract",
  "office",
  "desk",
  "phone",
  "message",
  "text",
  "conversation",
  "interview",
  "offer",
  "letter",
  "package",
  "receipt",
  "bank",
  "account",
  "deposit",
  "check",
  "key",
  "door",
  "car",
  "train",
  "flight",
  "ticket",
  "calendar",
  "appointment",
  "colleague",
  "manager",
  "client",
  "customer",
  "neighbor",
  "friend",
  "partner",
  "room",
  "kitchen",
  "street",
  "building",
  "sign",
  "name",
  "badge",
  "uniform",
  "shoes",
  "jacket",
  "wallet",
  "laptop",
  "screen",
  "notification",
  "alarm",
  "clock",
  "mirror",
  "window",
  "table",
  "chair",
  "pen",
  "paper",
  "notebook",
  "coffee",
  "cup",
  "plate",
  "meal",
  "gym",
  "weight",
  "scale",
  "number",
  "dollar",
  "percent",
  "hour",
  "minute",
  "mile",
  "step",
  "smile",
  "hand",
  "voice",
  "knock",
  "ring",
  "bell",
]);

/** Heuristic documented in AMBIGUITIES.md §2.4 features */
export function hasConcreteNounToken(feature: string): boolean {
  if (/\b\d+([.,]\d+)?%?\b/.test(feature)) return true;
  const tokens = feature.toLowerCase().match(/[a-z']+/g) ?? [];
  return tokens.some((token) => {
    if (token.length < 3) return false;
    if (ABSTRACT_DENYLIST.has(token)) return false;
    if (CONCRETE_NOUN_LEXICON.has(token)) return true;
    return token.length >= 5 && !token.endsWith("ness") && !token.endsWith("tion");
  });
}

function maxTimeframeDate(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 24);
  return d;
}

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const timeframeSchema = z
  .string()
  .min(1, "timeframe is required")
  .refine(
    (val) =>
      (TIMEFRAME_PRESETS as readonly string[]).includes(val) ||
      isoDateRegex.test(val),
    "timeframe must be an ISO date (YYYY-MM-DD) or preset 30d|60d|90d",
  )
  .refine((val) => {
    if ((TIMEFRAME_PRESETS as readonly string[]).includes(val)) return true;
    const parsed = new Date(`${val}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parsed >= today && parsed <= maxTimeframeDate();
  }, "timeframe must be today through 24 months out");

const prerequisiteItemSchema = z
  .string()
  .min(5, "each prerequisite must be at least 5 characters")
  .max(140, "each prerequisite must be at most 140 characters");

const syncActionSchema = z.object({
  action: z.string().min(1, "sync action text is required"),
  deadline: z.string().optional(),
});

const sessionPrefsSchema = z.object({
  duration_min: z.literal(20).or(z.literal(30)).or(z.literal(40)).or(z.literal(60)).default(40),
  entrainment_mode: z.enum(["binaural", "isochronic"]).default("isochronic"),
  senses_emphasis: z
    .array(z.string().min(1))
    .min(2, "senses_emphasis must include at least 2 senses"),
  aos_layer: z.enum(["ego", "self", "persona", "shadow"]).optional(),
});

export const intakeSchema = z.object({
  goal_statement: z
    .string()
    .min(10, "goal_statement must be at least 10 characters")
    .max(280, "goal_statement must be at most 280 characters")
    .refine(
      (val) => !/^\s*i\s+(want|will)\b/i.test(val),
      'goal_statement must not begin with "I want" or "I will" (present-tense lint)',
    ),
  localization: z.object({
    timeframe: timeframeSchema,
    place: z.string().min(1, "place is required"),
  }),
  triangulation: z
    .tuple([prerequisiteItemSchema, prerequisiteItemSchema, prerequisiteItemSchema])
    .describe("exactly 3 prerequisites"),
  not_list: z
    .array(z.string().min(1))
    .min(2, "not_list must have 2-5 items")
    .max(5, "not_list must have 2-5 items"),
  wrong_pulls: z
    .array(z.string().min(1))
    .max(3, "wrong_pulls must have 0-3 items")
    .default([]),
  features: z
    .array(z.string().min(1))
    .min(3, "features must have 3-7 items")
    .max(7, "features must have 3-7 items")
    .refine(
      (items) => items.every(hasConcreteNounToken),
      "each feature must contain at least one concrete-noun token (observability lint)",
    ),
  sync_actions: z
    .array(syncActionSchema)
    .min(1, "sync_actions must have 1-5 items")
    .max(5, "sync_actions must have 1-5 items"),
  session: sessionPrefsSchema.default({
    duration_min: 40,
    entrainment_mode: "isochronic",
    senses_emphasis: ["sight", "touch"],
  }),
});

export type Intake = z.infer<typeof intakeSchema>;

export function parseIntake(input: unknown): Intake {
  return intakeSchema.parse(input);
}

export function safeParseIntake(input: unknown) {
  return intakeSchema.safeParse(input);
}
