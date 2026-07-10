import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/db/service-client";
import { loadPlaybackManifest } from "@/lib/playback/manifest";
import { SessionPlayer } from "./player";

interface PageProps {
  params: Promise<{ scriptId: string }>;
}

export default async function SessionPage({ params }: PageProps) {
  const { scriptId } = await params;
  const supabase = getServiceClient();
  const manifest = await loadPlaybackManifest(supabase, scriptId);

  if (!manifest) {
    notFound();
  }

  if (manifest.meta.status !== "ready") {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Session not ready</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Script status is <strong>{manifest.meta.status}</strong>. Playback is available when
          synthesis is complete.
        </p>
        {manifest.meta.error_message ? (
          <p className="mt-2 text-sm text-amber-700">{manifest.meta.error_message}</p>
        ) : null}
      </main>
    );
  }

  const missingAudio = manifest.segments.some((segment) => !segment.signedUrl);
  if (missingAudio) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Audio unavailable</h1>
        <p className="mt-2 text-sm text-neutral-600">
          One or more segments are missing signed audio URLs.
        </p>
      </main>
    );
  }

  return <SessionPlayer manifest={manifest} />;
}
