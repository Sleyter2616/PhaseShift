import { notFound, redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { getSessionUser } from "@/lib/auth/session";
import { userOwnsScript } from "@/lib/auth/ownership";
import { getServiceClient } from "@/lib/db/service-client";
import { loadPlaybackManifest } from "@/lib/playback/manifest";
import { createClient } from "@/lib/supabase/server";
import { SessionPlayer } from "./player";

interface PageProps {
  params: Promise<{ scriptId: string }>;
}

export default async function SessionPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { scriptId } = await params;
  const userSupabase = await createClient();
  if (!(await userOwnsScript(userSupabase, scriptId))) {
    notFound();
  }

  const manifest = await loadPlaybackManifest(getServiceClient(), scriptId);
  if (!manifest) {
    notFound();
  }

  const notReady = (
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

  const missingAudio = (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Audio unavailable</h1>
      <p className="mt-2 text-sm text-neutral-600">
        One or more segments are missing signed audio URLs.
      </p>
    </main>
  );

  return (
    <>
      <AuthHeader />
      {manifest.meta.status !== "ready"
        ? notReady
        : manifest.segments.some((segment) => !segment.signedUrl)
          ? missingAudio
          : <SessionPlayer manifest={manifest} />}
    </>
  );
}
