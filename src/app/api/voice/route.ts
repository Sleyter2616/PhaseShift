import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processVoiceSample } from "@/lib/voice/process-voice-sample";
import {
  parseDurationSecField,
  validateVoiceSampleUpload,
} from "@/lib/voice/sample-limits";

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
      const status = result.error === "consent required before recording" ? 403 : 502;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ status: "ready" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
