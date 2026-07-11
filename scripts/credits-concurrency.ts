import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
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
  const email = `credits-${suffix}@test.local`;
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

    await admin.from("profiles").upsert({ id: userId, credit_balance: 5 });

    const client = createClient(url!, anonKey!);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(signInError.message);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.rpc("spend_credits", {
          p_script: null,
          p_amount: 1,
          p_reason: "generation",
        }),
      ),
    );

    const succeeded = results.filter((result) => !result.error).length;
    const insufficient = results.filter((result) =>
      (result.error?.message ?? "").includes("insufficient_credits"),
    ).length;

    const unexpected = new Map<string, number>();
    for (const result of results) {
      if (!result.error) continue;
      const message = result.error.message;
      if (message.includes("insufficient_credits")) continue;
      unexpected.set(message, (unexpected.get(message) ?? 0) + 1);
    }
    for (const [message, count] of unexpected) {
      console.log(`UNEXPECTED ${count}x: ${message}`);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    const { count: ledgerCount } = await admin
      .from("credit_ledger")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (succeeded === 5) pass("exactly 5 spend_credits calls succeeded");
    else fail("exactly 5 spend_credits calls succeeded", `got ${succeeded}`);

    if (insufficient === 5) pass("exactly 5 spend_credits calls failed insufficient_credits");
    else fail("exactly 5 spend_credits calls failed insufficient_credits", `got ${insufficient}`);

    if (profile?.credit_balance === 0) pass("final credit_balance is 0");
    else fail("final credit_balance is 0", `balance=${profile?.credit_balance}`);

    if (ledgerCount === 5) pass("exactly 5 credit_ledger rows");
    else fail("exactly 5 credit_ledger rows", `count=${ledgerCount}`);
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
