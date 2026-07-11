import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { WizardFlow } from "./wizard-flow";

export default async function WizardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: readyVoice } = await supabase
    .from("voice_profiles")
    .select("id")
    .eq("status", "ready")
    .maybeSingle();

  const stockVoiceLabel = process.env.ELEVENLABS_STOCK_VOICE_ID
    ? "Stock voice"
    : "Default stock voice";

  return (
    <>
      <AuthHeader />
      <main className="mx-auto max-w-2xl p-6">
        <WizardFlow
          readyVoiceProfileId={readyVoice?.id ?? null}
          stockVoiceLabel={stockVoiceLabel}
        />
      </main>
    </>
  );
}
