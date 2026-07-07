import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = "dev@phaseshift.local";
const password = randomBytes(16).toString("base64url");

async function main() {
  const { data: listData } = await supabase.auth.admin.listUsers();
  const existing = listData.users.find((user) => user.email === email);

  let userId: string;
  if (existing) {
    userId = existing.id;
    console.log(`User already exists: ${userId}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      console.error("createUser failed:", error?.message);
      process.exit(1);
    }
    userId = data.user.id;
    console.log(`Created user ${email}`);
    console.log(`Password (save once): ${password}`);
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    tier: "practitioner",
    credit_balance: 100,
  });

  if (profileError) {
    console.error("profiles upsert failed:", profileError.message);
    process.exit(1);
  }

  console.log("\nSet in .env.local:");
  console.log(`DEV_USER_ID=${userId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
