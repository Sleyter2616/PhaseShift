"use server";

import { revalidatePath } from "next/cache";
import { cloneVoiceWithElevenLabs, mockClonedVoiceId } from "@/lib/tts/clone-voice";
import { defaultTtsProvider } from "@/lib/pipeline/synthesis-identity";
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

export async function submitVoiceSample(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "unauthorized" };
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { error: "missing audio sample" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("voice_profiles")
    .select("id, consent_confirmed_at, status")
    .maybeSingle();

  if (profileError) {
    return { error: profileError.message };
  }
  if (!profile?.id || !profile.consent_confirmed_at) {
    return { error: "consent required before recording" };
  }

  const { error: pendingError } = await supabase
    .from("voice_profiles")
    .update({ status: "pending" })
    .eq("id", profile.id);

  if (pendingError) {
    return { error: pendingError.message };
  }

  let providerVoiceId: string;
  const provider = defaultTtsProvider();
  const apiKey = process.env.ELEVENLABS_API_KEY;

  try {
    if (provider === "selfhost" || !apiKey) {
      providerVoiceId = mockClonedVoiceId(user.id);
    } else {
      providerVoiceId = await cloneVoiceWithElevenLabs(
        apiKey,
        `phaseshift-${user.id.slice(0, 8)}`,
        audio,
      );
    }
  } catch (cloneError) {
    const message = cloneError instanceof Error ? cloneError.message : "voice clone failed";
    await supabase
      .from("voice_profiles")
      .update({ status: "failed" })
      .eq("id", profile.id);
    return { error: message };
  }

  const { error: readyError } = await supabase
    .from("voice_profiles")
    .update({
      provider_voice_id: providerVoiceId,
      status: "ready",
    })
    .eq("id", profile.id);

  if (readyError) {
    return { error: readyError.message };
  }

  revalidatePath("/voice");
  revalidatePath("/wizard");
  return {};
}
