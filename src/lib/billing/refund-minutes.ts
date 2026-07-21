import type { ServiceClient } from "@/lib/db/service-client";
import type { MinutePool, SpendBreakdown } from "./minutes";

export function normalizeSpendRpcResult(data: unknown): SpendBreakdown {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { subscription_spent?: number; topup_spent?: number }
    | null
    | undefined;
  const subscriptionSpent = Number(row?.subscription_spent ?? 0);
  const topupSpent = Number(row?.topup_spent ?? 0);
  if (
    !Number.isInteger(subscriptionSpent) ||
    !Number.isInteger(topupSpent) ||
    subscriptionSpent < 0 ||
    topupSpent < 0
  ) {
    throw new Error("invalid_spend_minutes_result");
  }
  return { subscriptionSpent, topupSpent };
}

export async function refundMinutesBreakdown(
  supabase: ServiceClient,
  userId: string,
  scriptId: string | null,
  breakdown: SpendBreakdown,
): Promise<void> {
  const parts: Array<{ pool: MinutePool; minutes: number }> = [];
  if (breakdown.subscriptionSpent > 0) {
    parts.push({ pool: "subscription", minutes: breakdown.subscriptionSpent });
  }
  if (breakdown.topupSpent > 0) {
    parts.push({ pool: "topup", minutes: breakdown.topupSpent });
  }
  for (const part of parts) {
    const { error } = await supabase.rpc("refund_minutes", {
      p_user: userId,
      p_minutes: part.minutes,
      p_pool: part.pool,
      p_script: scriptId,
    });
    if (error) throw new Error(error.message);
  }
}

/** Idempotent refund from minutes_ledger spend rows for a script. */
export async function refundMinutesForFailedScript(
  supabase: ServiceClient,
  userId: string,
  scriptId: string,
): Promise<void> {
  const { data: existingRefund, error: refundLookupError } = await supabase
    .from("minutes_ledger")
    .select("id")
    .eq("script_id", scriptId)
    .eq("reason", "refund")
    .limit(1);

  if (refundLookupError) throw new Error(refundLookupError.message);
  if (existingRefund && existingRefund.length > 0) return;

  const { data: spendRows, error: spendLookupError } = await supabase
    .from("minutes_ledger")
    .select("delta, pool")
    .eq("script_id", scriptId)
    .eq("reason", "spend");

  if (spendLookupError) throw new Error(spendLookupError.message);

  const breakdown: SpendBreakdown = { subscriptionSpent: 0, topupSpent: 0 };
  for (const row of spendRows ?? []) {
    const minutes = Math.abs(Number(row.delta));
    if (!Number.isInteger(minutes) || minutes <= 0) continue;
    if (row.pool === "subscription") breakdown.subscriptionSpent += minutes;
    if (row.pool === "topup") breakdown.topupSpent += minutes;
  }

  if (breakdown.subscriptionSpent === 0 && breakdown.topupSpent === 0) return;
  await refundMinutesBreakdown(supabase, userId, scriptId, breakdown);
}

export function isInsufficientMinutesError(error: { message?: string }): boolean {
  return (error.message ?? "").includes("insufficient_minutes");
}
