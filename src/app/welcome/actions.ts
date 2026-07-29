"use server";

import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/auth/session";
import { maybeGrantWelcomeMinutes } from "@/lib/billing/welcome-grant";
import { getServiceClient } from "@/lib/db/service-client";

/** Mark first-run onboarding complete, then open the intake wizard. */
export async function completeOnboarding() {
  const { supabase, user } = await requireSessionUser();

  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarded_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  // Grant only on the null → set transition (exactly once per user).
  if (updated) {
    await maybeGrantWelcomeMinutes(getServiceClient(), user.id, true);
  }

  redirect("/wizard");
}
