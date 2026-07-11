import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { VoiceOnboarding } from "./voice-onboarding";

export default async function VoicePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("status, consent_confirmed_at")
    .maybeSingle();

  const status =
    profile?.status === "ready" ||
    profile?.status === "pending" ||
    profile?.status === "failed"
      ? profile.status
      : "none";

  return (
    <>
      <AuthHeader />
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Voice onboarding</h1>
        <VoiceOnboarding
          status={status}
          consentConfirmed={Boolean(profile?.consent_confirmed_at)}
        />
      </main>
    </>
  );
}
