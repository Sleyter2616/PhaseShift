import { NextResponse } from "next/server";
import {
  processVoiceSample,
  retryVoiceCloneFromStoredSample,
  VOICE_CLONING_NOT_CONFIGURED,
} from "@/lib/voice/process-voice-sample";
import { createClient } from "@/lib/supabase/server";
import {
  parseDurationSecField,
  validateVoiceSampleUpload,
} from "@/lib/voice/sample-limits";

function voiceErrorStatus(error: string, notConfigured?: boolean): number {
  if (notConfigured || error === VOICE_CLONING_NOT_CONFIGURED) return 422;
  if (error === "consent required before recording") return 403;
  if (error === "no stored voice sample") return 404;
  return 502;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "invalid form data" }, { status: 400 });
    }

    const audio = formData.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "missing audio sample" }, { status: 400 });
    }

    const durationSec = parseDurationSecField(formData.get("duration_sec"));
    if (durationSec != null && Number.isNaN(durationSec)) {
      return NextResponse.json({ error: "invalid duration_sec" }, { status: 400 });
    }

    const validationError = validateVoiceSampleUpload({
      byteLength: audio.size,
      durationSec,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const result = await processVoiceSample(supabase, user.id, audio);
    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: voiceErrorStatus(result.error, result.notConfigured) },
      );
    }

    return NextResponse.json(
      { status: "ready", provider_voice_id: result.provider_voice_id },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await retryVoiceCloneFromStoredSample(supabase, user.id);
    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: voiceErrorStatus(result.error, result.notConfigured) },
      );
    }

    return NextResponse.json(
      { status: "ready", provider_voice_id: result.provider_voice_id },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
