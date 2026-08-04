import { notFound, redirect } from "next/navigation";
import { SessionField } from "@/components/session-field";
import { getSessionUser } from "@/lib/auth/session";
import { userOwnsScript } from "@/lib/auth/ownership";
import { getServiceClient } from "@/lib/db/service-client";
import { loadPlaybackManifest } from "@/lib/playback/manifest";
import { needsSessionPrimer } from "@/lib/session/primer";
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

  const [{ data: profile, error: profileError }, manifest] = await Promise.all([
    userSupabase.from("profiles").select("primer_seen_at").eq("id", user.id).maybeSingle(),
    loadPlaybackManifest(getServiceClient(), scriptId),
  ]);

  if (!manifest) {
    notFound();
  }

  // Fail open if the column is not migrated yet; otherwise show until dismissed.
  const needsPrimer =
    profileError == null && profile != null && needsSessionPrimer(profile.primer_seen_at);

  const notReady = (
    <SessionField phase="alpha" className="items-center justify-center px-4 py-8">
      <div className="session-column max-w-md space-y-3 text-center">
        <h1 className="font-display text-2xl font-normal">Session not ready</h1>
        <p className="text-sm text-[var(--session-mid)]">
          Script status is <span className="text-[var(--session-text)]">{manifest.meta.status}</span>.
          Playback is available when synthesis is complete.
        </p>
        {manifest.meta.error_message ? (
          <p className="text-sm text-[var(--color-warning)]">{manifest.meta.error_message}</p>
        ) : null}
      </div>
    </SessionField>
  );

  const missingAudio = (
    <SessionField phase="alpha" className="items-center justify-center px-4 py-8">
      <div className="session-column max-w-md space-y-3 text-center">
        <h1 className="font-display text-2xl font-normal">Audio unavailable</h1>
        <p className="text-sm text-[var(--session-mid)]">
          One or more segments are missing signed audio URLs.
        </p>
      </div>
    </SessionField>
  );

  return manifest.meta.status !== "ready"
    ? notReady
    : manifest.segments.some((segment) => !segment.signedUrl)
      ? missingAudio
      : <SessionPlayer manifest={manifest} needsPrimer={needsPrimer} />;
}
