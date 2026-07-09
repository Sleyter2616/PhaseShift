import { NextResponse } from "next/server";
import { assertDevAuth, DevAuthError, devAuthErrorResponse } from "@/lib/auth/dev-secret";
import { getServiceClient } from "@/lib/db/service-client";

const SIGNED_URL_TTL_SEC = 86_400;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertDevAuth(request);
    const { id: scriptId } = await context.params;
    const supabase = getServiceClient();

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .select(
        "id, status, user_id, goal_version_id, provider, stock_voice_id, voice_profile_id, tts_model_id, total_duration_sec, entrainment_mode, prompt_version, llm_model, error_message, created_at",
      )
      .eq("id", scriptId)
      .single();

    if (scriptError || !script) {
      return NextResponse.json({ error: "script not found" }, { status: 404 });
    }

    const { data: segments, error: segmentError } = await supabase
      .from("script_segments")
      .select(
        "seq, phase, step, entrainment_hz, glide_to_hz, actual_duration_sec, scheduled_pause_after_ms, audio_file_id",
      )
      .eq("script_id", scriptId)
      .order("seq");

    if (segmentError) {
      return NextResponse.json({ error: segmentError.message }, { status: 500 });
    }

    const audioIds = [...new Set((segments ?? []).map((s) => s.audio_file_id).filter(Boolean))];
    const storageByAudioId = new Map<string, string>();

    if (audioIds.length > 0) {
      const { data: audioFiles, error: audioError } = await supabase
        .from("audio_files")
        .select("id, storage_path")
        .in("id", audioIds as string[]);

      if (audioError) {
        return NextResponse.json({ error: audioError.message }, { status: 500 });
      }

      for (const file of audioFiles ?? []) {
        storageByAudioId.set(file.id, file.storage_path);
      }
    }

    const manifestSegments = await Promise.all(
      (segments ?? []).map(async (segment) => {
        let signedUrl: string | null = null;
        if (segment.audio_file_id) {
          const storagePath = storageByAudioId.get(segment.audio_file_id);
          if (storagePath) {
            const { data, error } = await supabase.storage
              .from("audio")
              .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
            if (!error && data?.signedUrl) {
              signedUrl = data.signedUrl;
            }
          }
        }

        return {
          seq: segment.seq,
          phase: segment.phase,
          entrainment_hz: segment.entrainment_hz,
          glide_to_hz: segment.glide_to_hz,
          actual_duration_sec: segment.actual_duration_sec,
          scheduled_pause_after_ms: segment.scheduled_pause_after_ms,
          signedUrl,
        };
      }),
    );

    return NextResponse.json({
      meta: {
        script_id: script.id,
        status: script.status,
        goal_version_id: script.goal_version_id,
        provider: script.provider,
        stock_voice_id: script.stock_voice_id,
        voice_profile_id: script.voice_profile_id,
        tts_model_id: script.tts_model_id,
        total_duration_sec: script.total_duration_sec,
        entrainment_mode: script.entrainment_mode,
        prompt_version: script.prompt_version,
        llm_model: script.llm_model,
        error_message: script.error_message,
        created_at: script.created_at,
      },
      segments: manifestSegments,
    });
  } catch (error) {
    if (error instanceof DevAuthError) {
      return devAuthErrorResponse();
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
