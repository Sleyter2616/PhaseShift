import type { ServiceClient } from "@/lib/db/service-client";
import type { CompilerInput } from "@/lib/session/derive";

const SIGNED_URL_TTL_SEC = 86_400;

export interface EntrainmentPlanItem {
  phase: string;
  hz: number;
  glide_to?: number | null;
  glide_sec?: number;
}

export interface PlaybackManifestSegment {
  seq: number;
  phase: string;
  entrainment_hz: number;
  glide_to_hz: number | null;
  actual_duration_sec: number;
  scheduled_pause_after_ms: number;
  signedUrl: string | null;
}

export interface PlaybackManifest {
  meta: {
    script_id: string;
    status: string;
    goal_version_id: string;
    total_duration_sec: number | null;
    entrainment_mode: "binaural" | "isochronic";
    entrainment_plan: EntrainmentPlanItem[];
    error_message: string | null;
    provider: string;
  };
  segments: PlaybackManifestSegment[];
}

export async function loadPlaybackManifest(
  supabase: ServiceClient,
  scriptId: string,
): Promise<PlaybackManifest | null> {
  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select(
      "id, status, goal_version_id, total_duration_sec, entrainment_mode, error_message, compiler_input, provider",
    )
    .eq("id", scriptId)
    .single();

  if (scriptError || !script) return null;

  const compilerInput = script.compiler_input as CompilerInput | null;
  const entrainmentPlan = compilerInput?.session?.entrainment_plan ?? [];

  const { data: segments, error: segmentError } = await supabase
    .from("script_segments")
    .select(
      "seq, phase, entrainment_hz, glide_to_hz, actual_duration_sec, scheduled_pause_after_ms, audio_file_id",
    )
    .eq("script_id", scriptId)
    .order("seq");

  if (segmentError) return null;

  const audioIds = [...new Set((segments ?? []).map((s) => s.audio_file_id).filter(Boolean))];
  const storageByAudioId = new Map<string, string>();

  if (audioIds.length > 0) {
    const { data: audioFiles } = await supabase
      .from("audio_files")
      .select("id, storage_path")
      .in("id", audioIds as string[]);

    for (const file of audioFiles ?? []) {
      storageByAudioId.set(file.id, file.storage_path);
    }
  }

  const manifestSegments: PlaybackManifestSegment[] = await Promise.all(
    (segments ?? []).map(async (segment) => {
      let signedUrl: string | null = null;
      if (segment.audio_file_id) {
        const storagePath = storageByAudioId.get(segment.audio_file_id);
        if (storagePath) {
          const { data, error } = await supabase.storage
            .from("audio")
            .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
          if (!error && data?.signedUrl) signedUrl = data.signedUrl;
        }
      }

      return {
        seq: segment.seq,
        phase: segment.phase,
        entrainment_hz: Number(segment.entrainment_hz),
        glide_to_hz: segment.glide_to_hz != null ? Number(segment.glide_to_hz) : null,
        actual_duration_sec: Number(segment.actual_duration_sec ?? 0),
        scheduled_pause_after_ms: Number(segment.scheduled_pause_after_ms ?? 0),
        signedUrl,
      };
    }),
  );

  return {
    meta: {
      script_id: script.id,
      status: script.status,
      goal_version_id: script.goal_version_id,
      total_duration_sec: script.total_duration_sec,
      entrainment_mode: script.entrainment_mode as "binaural" | "isochronic",
      entrainment_plan: entrainmentPlan,
      error_message: script.error_message,
      provider: script.provider,
    },
    segments: manifestSegments,
  };
}
