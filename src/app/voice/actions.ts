"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function confirmVoiceConsent(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "unauthorized" };
  }

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("voice_profiles")
    .select("id")
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("voice_profiles")
      .update({
        consent_confirmed_at: now,
        status: "pending",
        provider_voice_id: null,
      })
      .eq("id", existing.id);

    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("voice_profiles").insert({
      user_id: user.id,
      consent_confirmed_at: now,
      status: "pending",
    });

    if (error) return { error: error.message };
  }

  revalidatePath("/voice");
  return {};
}
