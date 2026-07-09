import { createClient } from "@supabase/supabase-js";

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("service-client is server-only and must not run in the browser");
  }
}

export function getServiceClient() {
  assertServerOnly();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ServiceClient = ReturnType<typeof getServiceClient>;
