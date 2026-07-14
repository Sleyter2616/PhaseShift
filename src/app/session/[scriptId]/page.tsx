import { notFound, redirect } from "next/navigation";
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
    <main className="session-surface mx-auto flex max-w-xl flex-col justify-center px-4 py-10">
      <h1 className="font-display text-2xl text-[var(--session-text)]">Session not ready</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--session-mid)]">
        Script status is <strong className="font-medium text-[var(--session-text)]">{manifest.meta.status}</strong>.
        Playback is available when synthesis is complete.
      </p>
      {manifest.meta.error_message ? (
        <p className="mt-3 text-sm text-[var(--accent-sand)]">{manifest.meta.error_message}</p>
      ) : null}
    </main>
  );

  const missingAudio = (
    <main className="session-surface mx-auto flex max-w-xl flex-col justify-center px-4 py-10">
      <h1 className="font-display text-2xl text-[var(--session-text)]">Audio unavailable</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--session-mid)]">
        One or more segments are missing signed audio URLs.
      </p>
    </main>
  );

  if (manifest.meta.status !== "ready") return notReady;
  if (manifest.segments.some((segment) => !segment.signedUrl)) return missingAudio;
  return <SessionPlayer manifest={manifest} />;
}
