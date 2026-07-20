import { createClient } from "@/lib/supabase/server";

/** True when the profile has not completed /welcome. */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error(`needsOnboarding: ${error.message}`);
    return false;
  }

  return data?.onboarded_at == null;
}

/** Destination after sign-in / sign-up. */
export async function resolvePostAuthPath(userId: string): Promise<"/welcome" | "/scripts"> {
  return (await needsOnboarding(userId)) ? "/welcome" : "/scripts";
}
