import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_SUPABASE_ANON_KEY are required",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail?: string) {
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  process.exitCode = 1;
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const email = `minutes-${suffix}@test.local`;
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

    // 120 subscription + 40 topup = 160 min → exactly two own-voice 40min (80) spends.
    const { error: upsertError } = await admin.from("profiles").upsert({
      id: userId,
      subscription_minutes: 120,
      topup_minutes: 40,
    });
    if (upsertError) throw new Error(upsertError.message);

    const client = createClient(url!, anonKey!);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(signInError.message);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        client.rpc("spend_minutes", {
          p_user: userId,
          p_minutes: 80,
          p_script: null,
        }),
      ),
    );

    const succeeded = results.filter((result) => !result.error).length;
    const insufficient = results.filter((result) =>
      (result.error?.message ?? "").includes("insufficient_minutes"),
    ).length;

    const unexpected = new Map<string, number>();
    for (const result of results) {
      if (!result.error) continue;
      const message = result.error.message;
      if (message.includes("insufficient_minutes")) continue;
      unexpected.set(message, (unexpected.get(message) ?? 0) + 1);
    }
    for (const [message, count] of unexpected) {
      console.log(`UNEXPECTED ${count}x: ${message}`);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("subscription_minutes, topup_minutes")
      .eq("id", userId)
      .single();

    const { data: ledgerRows, error: ledgerError } = await admin
      .from("minutes_ledger")
      .select("delta, pool, reason")
      .eq("user_id", userId)
      .eq("reason", "spend");

    if (ledgerError) throw new Error(ledgerError.message);

    const spendRows = ledgerRows ?? [];
    const subSpent = spendRows
      .filter((row) => row.pool === "subscription")
      .reduce((sum, row) => sum + Math.abs(row.delta as number), 0);
    const topSpent = spendRows
      .filter((row) => row.pool === "topup")
      .reduce((sum, row) => sum + Math.abs(row.delta as number), 0);

    if (succeeded === 2) pass("exactly 2 spend_minutes calls succeeded");
    else fail("exactly 2 spend_minutes calls succeeded", `got ${succeeded}`);

    if (insufficient === 4) pass("exactly 4 spend_minutes calls failed insufficient_minutes");
    else fail("exactly 4 spend_minutes calls failed insufficient_minutes", `got ${insufficient}`);

    if (profile?.subscription_minutes === 0 && profile?.topup_minutes === 0) {
      pass("final pools are 0/0");
    } else {
      fail(
        "final pools are 0/0",
        `subscription=${profile?.subscription_minutes} topup=${profile?.topup_minutes}`,
      );
    }

    // Two successful spends of 80 from 120+40 → subscription 120 + topup 40 across ledger.
    if (subSpent === 120 && topSpent === 40) {
      pass("ledger spend totals match 120 subscription + 40 topup");
    } else {
      fail(
        "ledger spend totals match 120 subscription + 40 topup",
        `subscription=${subSpent} topup=${topSpent} rows=${spendRows.length}`,
      );
    }

    if (process.exitCode) {
      console.log("FAIL minutes concurrency");
    } else {
      console.log("PASS minutes concurrency");
    }
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
