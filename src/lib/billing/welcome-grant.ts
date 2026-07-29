import type { ServiceClient } from "@/lib/db/service-client";
import { grantTopupMinutesForUser } from "./webhook";

export const DEFAULT_WELCOME_GRANT_MINUTES = 400;

export type WelcomeGrantResult =
  | { granted: true; minutes: number }
  | {
      granted: false;
      minutes: number;
      reason: "disabled" | "not_just_onboarded" | "already_granted";
    };

/** Server-only: WELCOME_GRANT_ENABLED === "1" turns the grant on. */
export function isWelcomeGrantEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.WELCOME_GRANT_ENABLED === "1";
}

/** Server-only: WELCOME_GRANT_MINUTES, default 400. Invalid values fall back to default. */
export function welcomeGrantMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.WELCOME_GRANT_MINUTES;
  if (raw == null || raw.trim() === "") return DEFAULT_WELCOME_GRANT_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_WELCOME_GRANT_MINUTES;
  }
  return parsed;
}

/**
 * True if this user already has a topup purchase/grant ledger row for the
 * welcome amount (belt-and-suspenders against double grant).
 */
export async function hasWelcomeGrantLedgerRow(
  supabase: ServiceClient,
  userId: string,
  minutes: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("minutes_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("pool", "topup")
    .eq("delta", minutes)
    .in("reason", ["purchase", "grant"])
    .limit(1);

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * One-time welcome topup after onboarded_at transitions null → set.
 * No-op when the toggle is off, the user did not just onboard, or a matching
 * ledger row already exists.
 */
export async function maybeGrantWelcomeMinutes(
  supabase: ServiceClient,
  userId: string,
  justOnboarded: boolean,
  env: Record<string, string | undefined> = process.env,
): Promise<WelcomeGrantResult> {
  const minutes = welcomeGrantMinutes(env);

  if (!justOnboarded) {
    return { granted: false, minutes, reason: "not_just_onboarded" };
  }
  if (!isWelcomeGrantEnabled(env)) {
    return { granted: false, minutes, reason: "disabled" };
  }
  if (await hasWelcomeGrantLedgerRow(supabase, userId, minutes)) {
    return { granted: false, minutes, reason: "already_granted" };
  }

  await grantTopupMinutesForUser(supabase, userId, minutes);
  console.info(
    `welcome-grant: user_id=${userId} minutes=${minutes}`,
  );
  return { granted: true, minutes };
}
