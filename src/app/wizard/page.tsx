import { redirect } from "next/navigation";
import { SetupHeader } from "@/components/setup-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isRealReadyProfile } from "@/lib/voice/process-voice-sample";
import { stockVoiceOptionsFromEnv } from "@/lib/voice/stock-voices";
import { WizardFlow } from "./wizard-flow";

export default async function WizardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [{ data: voiceProfile }, { data: profile }] = await Promise.all([
    supabase.from("voice_profiles").select("id, status, provider_voice_id").maybeSingle(),
    supabase
      .from("profiles")
      .select("subscription_minutes, topup_minutes, subscription_minutes_reset_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const readyVoiceProfileId =
    voiceProfile && isRealReadyProfile(voiceProfile) ? voiceProfile.id : null;

  const stockVoices = stockVoiceOptionsFromEnv();

  return (
    <div className="setup-ground min-h-dvh">
      <SetupHeader />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <WizardFlow
          readyVoiceProfileId={readyVoiceProfileId}
          stockVoices={stockVoices}
          minutesBalance={{
            subscription: Number(profile?.subscription_minutes ?? 0),
            topup: Number(profile?.topup_minutes ?? 0),
            resetAt: profile?.subscription_minutes_reset_at ?? null,
          }}
        />
      </main>
    </div>
  );
}
