/**
 * Fallback when invoice.paid is missed/delayed: a past
 * subscription_minutes_reset_at must not linger on an active-looking profile.
 *
 * invoice.paid remains the source of truth for paid renewals. This path only
 * grants via grant_subscription_minutes after Stripe confirms status=active.
 * Lapsed / non-paying subscriptions never receive a complimentary refresh.
 */

import type Stripe from "stripe";
import { getServiceClient, type ServiceClient } from "../db/service-client";
import { capturePathError } from "../sentry/capture";
import { monthlyMinutesForTier } from "./minutes";
import { getStripeClient } from "./stripe-client";
import {
  grantSubscriptionMinutesForUser,
  subscriptionPeriodEnd,
  subscriptionTierFromItems,
  syncSubscriptionProfile,
} from "./webhook";

export type ReconcileSubscriptionResetResult =
  | { action: "current" }
  | { action: "granted"; periodEnd: string }
  | { action: "cleared_stale_date" }
  | { action: "skipped_unpaid" }
  | { action: "skipped_no_stripe" };

export type ReconcileSubscriptionResetInput = {
  userId: string;
  supabase: ServiceClient;
  stripe?: Pick<Stripe, "subscriptions">;
  now?: Date;
};

type ProfileResetRow = {
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_minutes_reset_at: string | null;
};

export function isSubscriptionResetStale(
  resetAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!resetAt) return false;
  const ms = Date.parse(resetAt);
  if (Number.isNaN(ms)) return false;
  return ms < now.getTime();
}

/** UI helper: never present a past reset_at as the next refresh date. */
export function displaySubscriptionResetAt(
  resetAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!resetAt || isSubscriptionResetStale(resetAt, now)) return null;
  return resetAt;
}

function periodEndIso(subscription: Stripe.Subscription): string | null {
  const unix = subscriptionPeriodEnd(subscription);
  if (unix == null) return null;
  return new Date(unix * 1000).toISOString();
}

async function loadCustomerSubscriptions(
  stripe: Pick<Stripe, "subscriptions">,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const open = await stripe.subscriptions.list({
    customer: customerId,
    limit: 10,
  });
  if (open.data.length > 0) return open.data;

  const canceled = await stripe.subscriptions.list({
    customer: customerId,
    status: "canceled",
    limit: 1,
  });
  return canceled.data;
}

export async function listStaleSubscriptionResetUserIds(
  supabase: ServiceClient,
  now: Date = new Date(),
  limit = 100,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .not("subscription_minutes_reset_at", "is", null)
    .lt("subscription_minutes_reset_at", now.toISOString())
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.id));
}

function pickActivePaidSubscription(
  subscriptions: readonly Stripe.Subscription[],
): Stripe.Subscription | null {
  return subscriptions.find((subscription) => subscription.status === "active") ?? null;
}

async function clearStaleResetAt(
  supabase: ServiceClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ subscription_minutes_reset_at: null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * If reset_at is in the past, ask Stripe whether the subscription is still paid.
 * Active → same grant path as invoice.paid. Otherwise clear the stale date and
 * sync status — never refill minutes for a lapsed customer.
 */
export async function reconcileStaleSubscriptionReset(
  input: ReconcileSubscriptionResetInput,
): Promise<ReconcileSubscriptionResetResult> {
  const now = input.now ?? new Date();

  const { data: profile, error } = await input.supabase
    .from("profiles")
    .select("stripe_customer_id, subscription_status, subscription_minutes_reset_at")
    .eq("id", input.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const row = profile as ProfileResetRow | null;
  if (!row) return { action: "current" };
  if (!isSubscriptionResetStale(row.subscription_minutes_reset_at, now)) {
    return { action: "current" };
  }

  const customerId = row.stripe_customer_id;
  if (!customerId) {
    await clearStaleResetAt(input.supabase, input.userId);
    return { action: "cleared_stale_date" };
  }

  let stripe: Pick<Stripe, "subscriptions">;
  try {
    stripe = input.stripe ?? getStripeClient();
  } catch {
    return { action: "skipped_no_stripe" };
  }

  const subscriptions = await loadCustomerSubscriptions(stripe, customerId);
  const active = pickActivePaidSubscription(subscriptions);
  const current = active ?? subscriptions[0] ?? null;

  if (!active) {
    if (current) {
      await syncSubscriptionProfile(input.supabase, input.userId, current);
    }
    await clearStaleResetAt(input.supabase, input.userId);
    return { action: "skipped_unpaid" };
  }

  const periodEnd = periodEndIso(active);
  const periodEndMs = periodEnd ? Date.parse(periodEnd) : Number.NaN;
  if (!periodEnd || Number.isNaN(periodEndMs) || periodEndMs <= now.getTime()) {
    await syncSubscriptionProfile(input.supabase, input.userId, active);
    await clearStaleResetAt(input.supabase, input.userId);
    return { action: "skipped_unpaid" };
  }

  const recordedResetMs = Date.parse(row.subscription_minutes_reset_at ?? "");
  if (!Number.isNaN(recordedResetMs) && recordedResetMs >= periodEndMs) {
    return { action: "current" };
  }

  const tier = subscriptionTierFromItems(active);
  if (!tier) {
    await syncSubscriptionProfile(input.supabase, input.userId, active);
    await clearStaleResetAt(input.supabase, input.userId);
    return { action: "skipped_unpaid" };
  }

  await grantSubscriptionMinutesForUser(
    input.supabase,
    input.userId,
    monthlyMinutesForTier(tier),
    periodEnd,
  );

  const { error: statusError } = await input.supabase
    .from("profiles")
    .update({
      subscription_status: "active",
      subscription_tier: tier,
      tier,
      subscription_current_period_end: periodEnd,
    })
    .eq("id", input.userId);
  if (statusError) throw new Error(statusError.message);

  return { action: "granted", periodEnd };
}

/**
 * Fail-open wrapper for page/API reads. Never throws; Stripe outages leave
 * balances unchanged (do not grant without verification).
 */
export async function maybeReconcileStaleSubscriptionResetForUser(
  userId: string,
  supabase?: ServiceClient,
): Promise<ReconcileSubscriptionResetResult | { action: "error" }> {
  try {
    return await reconcileStaleSubscriptionReset({
      userId,
      supabase: supabase ?? getServiceClient(),
    });
  } catch (error) {
    capturePathError(error, "billing.reconcile_subscription_reset");
    console.error(
      `subscription-reset-reconcile: user_id=${userId} ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { action: "error" };
  }
}
