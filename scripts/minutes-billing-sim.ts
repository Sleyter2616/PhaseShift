import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { createCheckoutSession } from "../src/lib/billing/checkout";
import { TOPUP_MINUTES } from "../src/lib/billing/minutes";
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail?: string) {
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  process.exitCode = 1;
}

async function main() {
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }
  if (!stripeKey?.startsWith("sk_test_")) {
    console.error("STRIPE_SECRET_KEY must be a Stripe test secret key (sk_test_…)");
    process.exit(1);
  }
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is required");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const suffix = randomUUID().slice(0, 8);
  const email = `minutes-billing-${suffix}@test.local`;
  const password = `test-${suffix}-pw`;
  let userId = "";

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) throw new Error(createError?.message ?? "createUser failed");
    userId = created.user.id;
    await admin.from("profiles").upsert({
      id: userId,
      topup_minutes: 0,
      subscription_minutes: 0,
    });

    const { data: beforeProfile } = await admin
      .from("profiles")
      .select("topup_minutes")
      .eq("id", userId)
      .single();
    const topupBefore = Number(beforeProfile?.topup_minutes ?? 0);

    const checkoutUrl = await createCheckoutSession({
      supabase: admin,
      user: created.user,
      kind: "topup",
    });
    if (!checkoutUrl.includes("checkout.stripe.com")) {
      fail("checkout session url", checkoutUrl);
    } else {
      pass("checkout session created via billing API logic");
    }

    const eventId = `evt_minutes_sim_${suffix}`;
    const payload = JSON.stringify({
      id: eventId,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_minutes_sim_${suffix}`,
          object: "checkout.session",
          mode: "payment",
          metadata: {
            user_id: userId,
            kind: "topup",
            minutes: String(TOPUP_MINUTES.minutes),
          },
        },
      },
    });

    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    const response = await fetch(`${appUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });
    const body = (await response.json()) as { received?: boolean; duplicate?: boolean };
    if (!response.ok || !body.received) {
      fail("webhook delivery", JSON.stringify(body));
    } else {
      pass("signed webhook accepted");
    }

    const { data: stripeEvent } = await admin
      .from("stripe_events")
      .select("id")
      .eq("id", eventId)
      .maybeSingle();
    if (stripeEvent?.id === eventId) pass("stripe_events row created");
    else fail("stripe_events row created");

    const { data: ledger } = await admin
      .from("minutes_ledger")
      .select("delta, pool, reason")
      .eq("user_id", userId)
      .eq("reason", "purchase")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ledger?.delta === TOPUP_MINUTES.minutes && ledger.pool === "topup") {
      pass("minutes_ledger purchase row added");
    } else {
      fail("minutes_ledger purchase row added", JSON.stringify(ledger));
    }

    const { data: afterProfile } = await admin
      .from("profiles")
      .select("topup_minutes")
      .eq("id", userId)
      .single();
    const topupAfter = Number(afterProfile?.topup_minutes ?? 0);
    if (topupAfter === topupBefore + TOPUP_MINUTES.minutes) {
      pass(`topup_minutes increased by ${TOPUP_MINUTES.minutes}`);
    } else {
      fail("topup_minutes increased", `before=${topupBefore} after=${topupAfter}`);
    }

    const replay = await fetch(`${appUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        }),
      },
      body: payload,
    });
    const replayBody = (await replay.json()) as { duplicate?: boolean };
    if (!replay.ok || !replayBody.duplicate) {
      fail("webhook replay marked duplicate", JSON.stringify(replayBody));
    } else {
      pass("webhook replay returns duplicate");
    }

    const { data: finalProfile } = await admin
      .from("profiles")
      .select("topup_minutes")
      .eq("id", userId)
      .single();
    if (Number(finalProfile?.topup_minutes ?? 0) === topupAfter) {
      pass("replay did not double-grant minutes (D26)");
    } else {
      fail("replay idempotency", `topup=${finalProfile?.topup_minutes}`);
    }

    if (process.exitCode) console.log("FAIL minutes billing sim");
    else console.log("PASS minutes billing sim");
  } finally {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
