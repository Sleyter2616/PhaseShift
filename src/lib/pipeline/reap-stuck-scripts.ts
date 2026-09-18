import type { ServiceClient } from "../db/service-client";
import type { SynthesizeSegmentInput } from "./synthesize-segment-job";
import { linkPendingSegmentsFromAudioCache } from "./dedupe-plan";
import {
  finalizeSynthesizedScript,
  phaseBudgetFromCompilerInput,
} from "./finalize-script";
import {
  loadScriptSynthesisIdentity,
  type ScriptVoiceSource,
} from "./synthesis-identity";

/** Scripts older than this with no progress are treated as stuck. */
export const STUCK_SCRIPT_MAX_AGE_MS = 10 * 60 * 1000;

/** Re-emit synthesize-segment this many times before failing the script. */
export const MAX_SYNTHESIS_REAP_ATTEMPTS = 2;

const SYNTHESIS_REAP_PREFIX = "SYNTHESIS_REAP:";

export type StuckSegmentStatus = "pending" | "processing" | "failed";

export type ReapStuckAction =
  | { scriptId: string; action: "failed_generating" }
  | { scriptId: string; action: "finalized" }
  | { scriptId: string; action: "retried"; segmentIds: string[]; attempt: number }
  | { scriptId: string; action: "failed_synthesis"; attempt: number }
  | { scriptId: string; action: "skipped" };

export type ReapStuckDeps = {
  supabase: ServiceClient;
  now?: Date;
  sendSynthesize: (input: SynthesizeSegmentInput) => Promise<void>;
  markFailed: (scriptId: string, message: string) => Promise<void>;
};

export type StuckScriptRow = ScriptVoiceSource & {
  id: string;
  status: string;
  created_at: string;
  error_message: string | null;
  compiler_input: unknown;
};

type StuckSegmentRow = {
  id: string;
  seq: number;
  text: string;
  pacing_wpm: number;
  content_hash: string;
  synthesis_status: string;
};

export function parseSynthesisReapAttempts(errorMessage: string | null | undefined): number {
  const match = new RegExp(`^${SYNTHESIS_REAP_PREFIX}(\\d+)$`).exec((errorMessage ?? "").trim());
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function formatSynthesisReapAttempt(attempt: number): string {
  return `${SYNTHESIS_REAP_PREFIX}${attempt}`;
}

export function isStuckSynthesisStatus(status: string): status is StuckSegmentStatus {
  return status === "pending" || status === "processing" || status === "failed";
}

/** Parent generate-script died during TTS — do not fail the whole script. */
export function shouldLeaveForSynthesisReaper(scriptStatus: string): boolean {
  return scriptStatus === "synthesizing";
}

export function nextSynthesizingReapDecision(args: {
  stuckSegmentCount: number;
  priorAttempts: number;
  maxAttempts?: number;
}): "finalize" | "retry" | "fail" {
  if (args.stuckSegmentCount <= 0) return "finalize";
  const max = args.maxAttempts ?? MAX_SYNTHESIS_REAP_ATTEMPTS;
  if (args.priorAttempts >= max) return "fail";
  return "retry";
}

function isPastStuckAge(createdAt: string, now: Date): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created >= STUCK_SCRIPT_MAX_AGE_MS;
}

export async function listStuckScriptCandidates(
  supabase: ServiceClient,
  now: Date,
): Promise<StuckScriptRow[]> {
  const cutoff = new Date(now.getTime() - STUCK_SCRIPT_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from("scripts")
    .select(
      "id, user_id, status, created_at, error_message, compiler_input, provider, stock_voice_id, voice_profile_id, tts_model_id",
    )
    .in("status", ["generating", "synthesizing"])
    .lt("created_at", cutoff)
    .limit(50);

  if (error) throw new Error(`stuck script list failed: ${error.message}`);
  return (data ?? []) as StuckScriptRow[];
}

async function countReadySegments(supabase: ServiceClient, scriptId: string): Promise<number> {
  const { count, error } = await supabase
    .from("script_segments")
    .select("id", { count: "exact", head: true })
    .eq("script_id", scriptId)
    .eq("synthesis_status", "ready");
  if (error) throw new Error(`ready segment count failed: ${error.message}`);
  return count ?? 0;
}

async function loadSegments(
  supabase: ServiceClient,
  scriptId: string,
): Promise<StuckSegmentRow[]> {
  const { data, error } = await supabase
    .from("script_segments")
    .select("id, seq, text, pacing_wpm, content_hash, synthesis_status")
    .eq("script_id", scriptId)
    .order("seq");
  if (error) throw new Error(`segment load failed: ${error.message}`);
  return (data ?? []) as StuckSegmentRow[];
}

async function reapGenerating(
  script: StuckScriptRow,
  deps: ReapStuckDeps,
): Promise<ReapStuckAction> {
  const ready = await countReadySegments(deps.supabase, script.id);
  if (ready > 0) {
    return { scriptId: script.id, action: "skipped" };
  }
  await deps.markFailed(
    script.id,
    "stuck generating >10 min with 0 ready segments",
  );
  return { scriptId: script.id, action: "failed_generating" };
}

async function reapSynthesizing(
  script: StuckScriptRow,
  deps: ReapStuckDeps,
): Promise<ReapStuckAction> {
  const identity = await loadScriptSynthesisIdentity(deps.supabase, script);
  await linkPendingSegmentsFromAudioCache(
    deps.supabase,
    { userId: script.user_id, assetScope: identity.assetScope },
    script.id,
  );

  const segments = await loadSegments(deps.supabase, script.id);
  if (segments.length === 0) {
    await deps.markFailed(script.id, "stuck synthesizing with no segments");
    return { scriptId: script.id, action: "failed_synthesis", attempt: 0 };
  }

  const stuck = segments.filter((s) => isStuckSynthesisStatus(s.synthesis_status));
  const priorAttempts = parseSynthesisReapAttempts(script.error_message);
  const decision = nextSynthesizingReapDecision({
    stuckSegmentCount: stuck.length,
    priorAttempts,
  });

  if (decision === "finalize") {
    await finalizeSynthesizedScript(
      deps.supabase,
      script.id,
      phaseBudgetFromCompilerInput(script.compiler_input),
    );
    return { scriptId: script.id, action: "finalized" };
  }

  if (decision === "fail") {
    await deps.markFailed(
      script.id,
      `stuck synthesizing after ${priorAttempts} dropped-segment retrigger(s)`,
    );
    return { scriptId: script.id, action: "failed_synthesis", attempt: priorAttempts };
  }

  const attempt = priorAttempts + 1;
  const ordered = [...segments].sort((a, b) => a.seq - b.seq);

  for (const segment of stuck) {
    if (segment.synthesis_status !== "pending") {
      const { error } = await deps.supabase
        .from("script_segments")
        .update({ synthesis_status: "pending" })
        .eq("id", segment.id)
        .eq("script_id", script.id)
        .neq("synthesis_status", "ready");
      if (error) throw new Error(`reset stuck segment failed: ${error.message}`);
    }
  }

  const { error: stampError } = await deps.supabase
    .from("scripts")
    .update({ error_message: formatSynthesisReapAttempt(attempt) })
    .eq("id", script.id)
    .eq("status", "synthesizing");
  if (stampError) throw new Error(`reap attempt stamp failed: ${stampError.message}`);

  for (const segment of stuck) {
    const orderedIndex = ordered.findIndex((row) => row.id === segment.id);
    const previousText = orderedIndex > 0 ? ordered[orderedIndex - 1]?.text : undefined;
    const nextText =
      orderedIndex >= 0 && orderedIndex < ordered.length - 1
        ? ordered[orderedIndex + 1]?.text
        : undefined;

    await deps.sendSynthesize({
      script_id: script.id,
      segment_id: segment.id,
      user_id: script.user_id,
      dedupe_key: segment.content_hash,
      text: segment.text,
      pacing_wpm: segment.pacing_wpm,
      previous_text: previousText,
      next_text: nextText,
    });
  }

  return {
    scriptId: script.id,
    action: "retried",
    segmentIds: stuck.map((s) => s.id),
    attempt,
  };
}

export async function reapOneStuckScript(
  script: StuckScriptRow,
  deps: ReapStuckDeps,
): Promise<ReapStuckAction> {
  if (script.status === "generating") {
    return reapGenerating(script, deps);
  }
  if (script.status === "synthesizing") {
    return reapSynthesizing(script, deps);
  }
  return { scriptId: script.id, action: "skipped" };
}

export async function reapStuckScripts(deps: ReapStuckDeps): Promise<ReapStuckAction[]> {
  const now = deps.now ?? new Date();
  const candidates = (await listStuckScriptCandidates(deps.supabase, now)).filter((row) =>
    isPastStuckAge(row.created_at, now),
  );

  const actions: ReapStuckAction[] = [];
  for (const script of candidates) {
    actions.push(await reapOneStuckScript(script, deps));
  }
  return actions;
}
