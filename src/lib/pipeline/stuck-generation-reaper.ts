import type { ServiceClient } from "@/lib/db/service-client";
import {
  refundMinutesForFailedScript,
  type RefundMinutesResult,
} from "@/lib/billing/refund-minutes";

/** Scripts stuck in generating longer than this with no progress are reaped. */
export const STUCK_GENERATING_AGE_MS = 10 * 60 * 1000;

export const STUCK_GENERATING_ERROR =
  "STUCK_GENERATING: no progress after 10 minutes (likely hard-killed); minutes refunded if unrefunded spend existed";

export type StuckGeneratingScript = {
  id: string;
  user_id: string;
  created_at: string;
  status: string;
};

export type ReapResult = {
  scriptId: string;
  ageMs: number;
  minutesRefunded: number;
  alreadyRefunded: boolean;
  markedFailed: boolean;
};

export function isOlderThanStuckThreshold(
  createdAt: string,
  nowMs: number,
  ageMs: number = STUCK_GENERATING_AGE_MS,
): boolean {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs >= ageMs;
}

/**
 * A candidate is reaped only when status=generating, age > threshold, and
 * zero ready segments (no synthesis progress).
 */
export function shouldReapStuckGenerating(args: {
  status: string;
  createdAt: string;
  readySegmentCount: number;
  nowMs: number;
  ageMs?: number;
}): boolean {
  if (args.status !== "generating") return false;
  if (args.readySegmentCount > 0) return false;
  return isOlderThanStuckThreshold(args.createdAt, args.nowMs, args.ageMs);
}

export async function countReadySegments(
  supabase: ServiceClient,
  scriptId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("script_segments")
    .select("id", { count: "exact", head: true })
    .eq("script_id", scriptId)
    .eq("synthesis_status", "ready");

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function findStuckGeneratingScripts(
  supabase: ServiceClient,
  nowMs: number = Date.now(),
  ageMs: number = STUCK_GENERATING_AGE_MS,
): Promise<StuckGeneratingScript[]> {
  const cutoffIso = new Date(nowMs - ageMs).toISOString();
  const { data, error } = await supabase
    .from("scripts")
    .select("id, user_id, created_at, status")
    .eq("status", "generating")
    .lt("created_at", cutoffIso);

  if (error) throw new Error(error.message);

  const candidates = (data ?? []) as StuckGeneratingScript[];
  const stuck: StuckGeneratingScript[] = [];

  for (const script of candidates) {
    const readyCount = await countReadySegments(supabase, script.id);
    if (
      shouldReapStuckGenerating({
        status: script.status,
        createdAt: script.created_at,
        readySegmentCount: readyCount,
        nowMs,
        ageMs,
      })
    ) {
      stuck.push(script);
    }
  }

  return stuck;
}

export async function reapStuckGeneratingScript(
  supabase: ServiceClient,
  script: StuckGeneratingScript,
  nowMs: number = Date.now(),
): Promise<ReapResult> {
  const ageMs = Math.max(0, nowMs - Date.parse(script.created_at));

  let refund: RefundMinutesResult = {
    alreadyRefunded: false,
    minutesRefunded: 0,
    breakdown: { subscriptionSpent: 0, topupSpent: 0 },
  };

  try {
    refund = await refundMinutesForFailedScript(supabase, script.user_id, script.id);
  } catch (error) {
    console.error("stuck-generation-reaper: refund failed", {
      scriptId: script.id,
      error: error instanceof Error ? error.message : error,
    });
  }

  const { error: updateError } = await supabase
    .from("scripts")
    .update({ status: "failed", error_message: STUCK_GENERATING_ERROR.slice(0, 4000) })
    .eq("id", script.id)
    .eq("status", "generating"); // race-safe: only if still generating

  if (updateError) throw new Error(updateError.message);

  await supabase
    .from("script_segments")
    .update({ synthesis_status: "failed" })
    .eq("script_id", script.id)
    .neq("synthesis_status", "ready");

  const result: ReapResult = {
    scriptId: script.id,
    ageMs,
    minutesRefunded: refund.minutesRefunded,
    alreadyRefunded: refund.alreadyRefunded,
    markedFailed: true,
  };

  console.error(
    `stuck-generation-reaper: reaped script=${result.scriptId} ` +
      `age_min=${(result.ageMs / 60_000).toFixed(1)} ` +
      `minutes_refunded=${result.minutesRefunded} ` +
      `already_refunded=${result.alreadyRefunded ? 1 : 0}`,
  );

  return result;
}

export async function runStuckGenerationReaper(
  supabase: ServiceClient,
  nowMs: number = Date.now(),
): Promise<ReapResult[]> {
  const stuck = await findStuckGeneratingScripts(supabase, nowMs);
  const results: ReapResult[] = [];
  for (const script of stuck) {
    results.push(await reapStuckGeneratingScript(supabase, script, nowMs));
  }
  console.error(`stuck-generation-reaper: scanned reaped=${results.length}`);
  return results;
}
