import { NextResponse } from "next/server";
import { userOwnsScript } from "@/lib/auth/ownership";
import { getServiceClient } from "@/lib/db/service-client";
import { loadPlaybackManifest } from "@/lib/playback/manifest";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id: scriptId } = await context.params;
    const owned = await userOwnsScript(supabase, scriptId);
    if (!owned) {
      return NextResponse.json({ error: "script not found" }, { status: 404 });
    }

    const manifest = await loadPlaybackManifest(getServiceClient(), scriptId);
    if (!manifest) {
      return NextResponse.json({ error: "script not found" }, { status: 404 });
    }

    return NextResponse.json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
