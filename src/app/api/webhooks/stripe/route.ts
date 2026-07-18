import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service-client";
import { getStripeClient } from "@/lib/billing/stripe-client";
import {
  handleStripeWebhookEvent,
  insertStripeEventIfNew,
} from "@/lib/billing/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });
  }

  const body = await request.text();
  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = getServiceClient();
  const insertResult = await insertStripeEventIfNew(supabase, event);
  if (insertResult === "duplicate") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeWebhookEvent({ supabase, event });
  } catch (error) {
    // Roll back idempotency marker so Stripe retries can re-process.
    await supabase.from("stripe_events").delete().eq("id", event.id);
    const message = error instanceof Error ? error.message : "handler failed";
    console.error(`stripe webhook handler error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
