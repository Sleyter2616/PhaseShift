import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env";

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
const password =
  process.env.DEV_USER_PASSWORD ?? `phase-shift-dev-${randomBytes(8).toString("hex")}`;

async function main() {
  const { data: listData } = await supabase.auth.admin.listUsers();
  const existing = listData.users.find((user) => user.email === email);

  let userId: string;
  if (existing) {
    userId = existing.id;
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      console.error("updateUser password failed:", updateError.message);
      process.exit(1);
    }
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

  console.log("\nSign in at http://localhost:3000/login");
  console.log(`Email: ${email}`);
  console.log(`DEV_USER_PASSWORD=${password}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
