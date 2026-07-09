import { NextResponse } from "next/server";
import { assertDevAuth, DevAuthError, devAuthErrorResponse } from "@/lib/auth/dev-secret";
import { getServiceClient } from "@/lib/db/service-client";
import { loadPlaybackManifest } from "@/lib/playback/manifest";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertDevAuth(request);
    const { id: scriptId } = await context.params;
    const supabase = getServiceClient();
    const manifest = await loadPlaybackManifest(supabase, scriptId);

    if (!manifest) {
      return NextResponse.json({ error: "script not found" }, { status: 404 });
    }

    return NextResponse.json(manifest);
  } catch (error) {
    if (error instanceof DevAuthError) {
      return devAuthErrorResponse();
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
