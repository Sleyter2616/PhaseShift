import { redirect } from "next/navigation";
import { SetupHeader } from "@/components/setup-header";
import { SiteFooter } from "@/components/site-footer";
import { getSessionUser } from "@/lib/auth/session";
import {
  draftFromPriorScript,
  summarizePriorSession,
  type PriorSessionOption,
} from "@/lib/contracts/wizard-from-prior";
import type { WizardDraft } from "@/lib/contracts/wizard";
import { createClient } from "@/lib/supabase/server";
import { pickBestVoiceProfile } from "@/lib/voice/profile-select";
import { stockVoiceOptionsFromEnv } from "@/lib/voice/stock-voices";
import { WizardFlow } from "./wizard-flow";

export default async function WizardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { from: fromScriptId } = await searchParams;

  const supabase = await createClient();
  const [{ data: voiceRows }, { data: profile }, { data: priorRows }] = await Promise.all([
    supabase
      .from("voice_profiles")
      .select("id, status, provider_voice_id, consent_confirmed_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("subscription_minutes, topup_minutes, subscription_minutes_reset_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("scripts")
      .select("id, created_at, compiler_input, entrainment_mode, voice_profile_id, stock_voice_id")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const voice = pickBestVoiceProfile(voiceRows);
  const readyVoiceProfileId = voice.readyId;

  const stockVoices = stockVoiceOptionsFromEnv();

  const priorSessions: PriorSessionOption[] = [];
  const priorDrafts: Record<string, WizardDraft> = {};

  for (const row of priorRows ?? []) {
    const summary = summarizePriorSession({
      id: row.id,
      created_at: row.created_at,
      compiler_input: row.compiler_input,
    });
    if (!summary) continue;

    const draft = draftFromPriorScript({
      compilerInput: row.compiler_input,
      entrainment_mode: row.entrainment_mode,
      voice_profile_id: row.voice_profile_id,
      stock_voice_id: row.stock_voice_id,
    });
    if (!draft) continue;

    priorSessions.push(summary);
    priorDrafts[row.id] = draft;
  }

  const initialFromScriptId =
    fromScriptId && priorDrafts[fromScriptId] ? fromScriptId : null;
  const initialDraft = initialFromScriptId ? priorDrafts[initialFromScriptId]! : null;

  return (
    <div className="setup-ground flex min-h-dvh flex-col">
      <SetupHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6">
        <WizardFlow
          userId={user.id}
          readyVoiceProfileId={readyVoiceProfileId}
          voiceStatus={voice.status}
          stockVoices={stockVoices}
          minutesBalance={{
            subscription: Number(profile?.subscription_minutes ?? 0),
            topup: Number(profile?.topup_minutes ?? 0),
            resetAt: profile?.subscription_minutes_reset_at ?? null,
          }}
          priorSessions={priorSessions}
          priorDrafts={priorDrafts}
          initialDraft={initialDraft}
          initialFromScriptId={initialFromScriptId}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
