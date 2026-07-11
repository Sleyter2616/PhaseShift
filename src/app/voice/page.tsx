import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  isMockProviderVoiceId,
  isRealReadyProfile,
  storedVoiceSampleExists,
} from "@/lib/voice/process-voice-sample";
import { VoiceOnboarding } from "./voice-onboarding";

export default async function VoicePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("status, consent_confirmed_at, provider_voice_id")
    .maybeSingle();

  const hasStoredSample = await storedVoiceSampleExists(user.id);
  const isMockReady =
    profile?.status === "ready" && isMockProviderVoiceId(profile.provider_voice_id);

  const status = isRealReadyProfile(profile ?? { status: "none", provider_voice_id: null })
    ? "ready"
    : profile?.status === "failed" || isMockReady
      ? "failed"
      : profile?.status === "pending"
        ? "pending"
        : "none";

  const providerVoiceId =
    profile?.provider_voice_id && !isMockProviderVoiceId(profile.provider_voice_id)
      ? profile.provider_voice_id
      : null;

  const canRetryStoredSample = hasStoredSample && status === "failed";

  return (
    <>
      <AuthHeader />
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Voice onboarding</h1>
        <VoiceOnboarding
          status={status}
          consentConfirmed={Boolean(profile?.consent_confirmed_at)}
          providerVoiceId={providerVoiceId}
          canRetryStoredSample={canRetryStoredSample}
        />
      </main>
    </>
  );
}
