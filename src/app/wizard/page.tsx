import { redirect } from "next/navigation";
import { SetupHeader } from "@/components/setup-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isRealReadyProfile } from "@/lib/voice/process-voice-sample";
import { WizardFlow } from "./wizard-flow";

export default async function WizardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: voiceProfile } = await supabase
    .from("voice_profiles")
    .select("id, status, provider_voice_id")
    .maybeSingle();

  const readyVoiceProfileId =
    voiceProfile && isRealReadyProfile(voiceProfile) ? voiceProfile.id : null;

  const stockVoiceLabel = process.env.ELEVENLABS_STOCK_VOICE_ID
    ? "Stock voice"
    : "Default stock voice";

  return (
    <div className="setup-surface">
      <SetupHeader />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        <WizardFlow
          readyVoiceProfileId={readyVoiceProfileId}
          stockVoiceLabel={stockVoiceLabel}
        />
      </main>
    </div>
  );
}
