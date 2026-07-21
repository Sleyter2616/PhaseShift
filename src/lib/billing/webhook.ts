import type Stripe from "stripe";
import type { ServiceClient } from "../db/service-client";
import {
  monthlyMinutesForTier,
  tierForStripePriceId,
  TOPUP_MINUTES,
  type MinutesTierId,
} from "./minutes";

export interface StripeWebhookContext {
  supabase: ServiceClient;
  event: Stripe.Event;
}

export type StripeEventInsertResult = "inserted" | "duplicate";

export async function insertStripeEventIfNew(
  supabase: ServiceClient,
  event: Pick<Stripe.Event, "id" | "type">,
): Promise<StripeEventInsertResult> {
  const { error } = await supabase.from("stripe_events").insert({
    id: event.id,
    type: event.type,
  });

  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`stripe_events insert failed: ${error.message}`);
  }
  return "inserted";
}

export async function findUserIdByStripeCustomer(
  supabase: ServiceClient,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function grantTopupMinutesForUser(
  supabase: ServiceClient,
  userId: string,
  minutes: number,
): Promise<void> {
  const { error } = await supabase.rpc("grant_topup_minutes", {
    p_user: userId,
    p_minutes: minutes,
  });
  if (error) throw new Error(error.message);
}

export async function grantSubscriptionMinutesForUser(
  supabase: ServiceClient,
  userId: string,
  minutes: number,
  periodEnd: string,
): Promise<void> {
  const { error } = await supabase.rpc("grant_subscription_minutes", {
    p_user: userId,
    p_minutes: minutes,
    p_period_end: periodEnd,
  });
  if (error) throw new Error(error.message);
}

function subscriptionTierFromItems(
  subscription: Stripe.Subscription,
): MinutesTierId | null {
  const priceId = subscription.items.data[0]?.price?.id;
  if (!priceId) return null;
  return tierForStripePriceId(priceId);
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
  const fromItem = subscription.items?.data?.[0]?.current_period_end;
  if (typeof fromItem === "number") return fromItem;
  const legacy = (subscription as { current_period_end?: number }).current_period_end;
  return typeof legacy === "number" ? legacy : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const nested = invoice.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "id" in nested) return nested.id;
  const legacy = (invoice as { subscription?: string | Stripe.Subscription | null }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return legacy.id;
  return null;
}

function invoiceLinePriceId(line: Stripe.InvoiceLineItem | undefined): string | null {
  if (!line) return null;
  const fromPricing = line.pricing?.price_details?.price;
  if (typeof fromPricing === "string") return fromPricing;
  const legacy = (line as { price?: { id?: string } | null }).price?.id;
  return legacy ?? null;
}

function invoicePeriodEndIso(invoice: Stripe.Invoice): string | null {
  const linePeriodEnd = invoice.lines?.data?.[0]?.period?.end;
  if (typeof linePeriodEnd === "number") {
    return new Date(linePeriodEnd * 1000).toISOString();
  }
  const legacy = (invoice as { period_end?: number }).period_end;
  if (typeof legacy === "number") {
    return new Date(legacy * 1000).toISOString();
  }
  return null;
}

export async function syncSubscriptionProfile(
  supabase: ServiceClient,
  userId: string,
  subscription: Stripe.Subscription,
): Promise<MinutesTierId | null> {
  const tier = subscriptionTierFromItems(subscription);
  const status =
    subscription.status === "active"
      ? "active"
      : subscription.status === "past_due"
        ? "past_due"
        : subscription.status === "canceled"
          ? "canceled"
          : "none";

  const periodEndUnix = subscriptionPeriodEnd(subscription);
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  const { error } = await supabase
    .from("profiles")
    .update({
      subscription_status: status,
      subscription_tier: tier,
      subscription_current_period_end: periodEnd,
      ...(status === "active" && tier ? { tier } : {}),
      ...(status === "canceled" ? { tier: "trial", subscription_tier: null } : {}),
    })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  return tier;
}

export function topupMinutesFromSession(session: Stripe.Checkout.Session): number {
  const metadataMinutes = session.metadata?.minutes;
  if (metadataMinutes) {
    const parsed = Number(metadataMinutes);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return TOPUP_MINUTES.minutes;
}

export async function handleStripeWebhookEvent(ctx: StripeWebhookContext): Promise<void> {
  const { supabase, event } = ctx;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "payment") {
        const userId = session.metadata?.user_id;
        if (!userId) break;
        await grantTopupMinutesForUser(supabase, userId, topupMinutesFromSession(session));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      const userId = await findUserIdByStripeCustomer(supabase, customerId);
      if (!userId) break;
      await syncSubscriptionProfile(supabase, userId, subscription);
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      const userId = await findUserIdByStripeCustomer(supabase, customerId);
      if (!userId) break;
      // Keep remaining minutes until period end — do not zero pools.
      await supabase
        .from("profiles")
        .update({
          subscription_status: "canceled",
          subscription_tier: null,
          tier: "trial",
        })
        .eq("id", userId);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoiceSubscriptionId(invoice)) break;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId) break;
      const userId = await findUserIdByStripeCustomer(supabase, customerId);
      if (!userId) break;

      const priceId = invoiceLinePriceId(invoice.lines.data[0]);
      if (!priceId) break;
      const tier = tierForStripePriceId(priceId);
      if (!tier) break;

      const periodEnd = invoicePeriodEndIso(invoice);
      if (!periodEnd) break;

      await grantSubscriptionMinutesForUser(
        supabase,
        userId,
        monthlyMinutesForTier(tier),
        periodEnd,
      );

      await supabase
        .from("profiles")
        .update({
          subscription_status: "active",
          subscription_tier: tier,
          tier,
          subscription_current_period_end: periodEnd,
        })
        .eq("id", userId);
      break;
    }
    default:
      console.error(`stripe webhook: unhandled event type ${event.type}`);
  }
}
