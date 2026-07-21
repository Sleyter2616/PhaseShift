"use server";

import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/auth/session";

/** Mark first-run onboarding complete, then open the intake wizard. */
export async function completeOnboarding() {
  const { supabase, user } = await requireSessionUser();

  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarded_at", null);

  if (error) {
    throw new Error(error.message);
  }

  redirect("/wizard");
}
