import { isRealReadyProfile } from "./process-voice-sample";

export type VoiceProfileRow = {
  id: string;
  status: string;
  provider_voice_id: string | null;
  consent_confirmed_at?: string | null;
};

export type WizardVoiceStatus = "ready" | "pending" | "failed" | "none";

export type ResolvedVoiceProfile = {
  readyId: string | null;
  status: WizardVoiceStatus;
  profile: VoiceProfileRow | null;
};

function rankProfile(row: VoiceProfileRow): number {
  if (isRealReadyProfile(row)) return 0;
  if (row.status === "ready") return 1; // mock-ready → failed UX, still ranks above pending
  if (row.status === "pending") return 2;
  if (row.status === "failed") return 3;
  return 4;
}

/**
 * Prefer a real ready clone. Avoids `.maybeSingle()` failing when duplicate
 * rows exist (PostgREST returns an error → wizard hides own-voice).
 */
export function pickBestVoiceProfile(
  rows: VoiceProfileRow[] | null | undefined,
): ResolvedVoiceProfile {
  const list = [...(rows ?? [])].sort((a, b) => rankProfile(a) - rankProfile(b));
  const best = list[0] ?? null;
  if (!best) {
    return { readyId: null, status: "none", profile: null };
  }

  if (isRealReadyProfile(best)) {
    return { readyId: best.id, status: "ready", profile: best };
  }

  if (best.status === "pending") {
    return { readyId: null, status: "pending", profile: best };
  }

  return { readyId: null, status: "failed", profile: best };
}
