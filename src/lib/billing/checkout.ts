import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  appBaseUrl,
  stripePriceIdForTier,
  stripeTopupPriceId,
  TOP_UP,
  type SubscriptionTierId,
} from "./plans";
import { getStripeClient } from "./stripe-client";

export type CheckoutKind = "topup" | "subscribe";

export async function ensureStripeCustomer(
  supabase: SupabaseClient,
  user: User,
): Promise<string> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (error) throw new Error(error.message);
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { user_id: user.id },
  });

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);

  if (updateError) throw new Error(updateError.message);
  return customer.id;
}

export async function createCheckoutSession(input: {
  supabase: SupabaseClient;
  user: User;
  kind: CheckoutKind;
  tier?: SubscriptionTierId;
}): Promise<string> {
  const customerId = await ensureStripeCustomer(input.supabase, input.user);
  const stripe = getStripeClient();
  const base = appBaseUrl();

  if (input.kind === "topup") {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: stripeTopupPriceId(), quantity: 1 }],
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=canceled`,
      metadata: {
        user_id: input.user.id,
        kind: "topup",
        credits: String(TOP_UP.credits),
      },
    });
    if (!session.url) throw new Error("checkout session missing url");
    return session.url;
  }

  if (!input.tier) throw new Error("tier is required for subscribe checkout");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: stripePriceIdForTier(input.tier), quantity: 1 }],
    success_url: `${base}/billing?checkout=success`,
    cancel_url: `${base}/billing?checkout=canceled`,
    metadata: {
      user_id: input.user.id,
      kind: "subscribe",
      tier: input.tier,
    },
  });
  if (!session.url) throw new Error("checkout session missing url");
  return session.url;
}

export async function createBillingPortalSession(
  supabase: SupabaseClient,
  user: User,
): Promise<string> {
  const customerId = await ensureStripeCustomer(supabase, user);
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appBaseUrl()}/billing`,
  });
  return session.url;
}
