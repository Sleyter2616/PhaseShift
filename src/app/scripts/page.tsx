import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupHeader } from "@/components/setup-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DevGoldenScriptButton } from "./dev-golden-script-button";
import { NewScriptButton } from "./new-script-button";
import { synthesisProvenanceBadge } from "@/lib/synthesis/provenance";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default async function ScriptsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: scripts, error } = await supabase
    .from("scripts")
    .select(
      "id, status, total_duration_sec, created_at, provider, stock_voice_id, voice_profile_id",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="setup-surface">
        <SetupHeader />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <p className="text-sm text-[#f0b4b4]">Failed to load scripts: {error.message}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="setup-surface">
      <SetupHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="setup-eyebrow">Home</p>
            <h1 className="font-display text-3xl tracking-tight text-[var(--text-hi)] sm:text-4xl">
              Your sessions
            </h1>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <NewScriptButton />
            {process.env.NODE_ENV === "development" ? <DevGoldenScriptButton /> : null}
          </div>
        </div>

        {scripts && scripts.length > 0 ? (
          <ul className="border-y border-[var(--setup-border)]">
            {scripts.map((script) => (
              <li
                key={script.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--setup-border)] py-4 last:border-b-0"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-sm text-[var(--text-hi)]">
                      {script.id}
                    </p>
                    <span className="setup-chip px-2 py-0.5 text-xs text-[var(--text-mid)]">
                      {synthesisProvenanceBadge(script)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-mid)]">
                    {script.status}
                    {script.total_duration_sec != null
                      ? ` · ${Math.round(script.total_duration_sec / 60)} min`
                      : ""}
                    {" · "}
                    {formatDate(script.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0">
                  {script.status === "ready" ? (
                    <Link
                      href={`/session/${script.id}`}
                      className="setup-btn-primary px-3 py-1.5 text-sm"
                    >
                      Play
                    </Link>
                  ) : (
                    <Link
                      href={`/dev/scripts/${script.id}`}
                      className="setup-btn-ghost px-3 py-1.5 text-sm"
                    >
                      Status
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="setup-note">
            No sessions yet.{" "}
            <Link
              href="/wizard"
              className="text-[var(--accent-sand)] underline-offset-2 hover:underline"
            >
              Start the intake wizard
            </Link>{" "}
            to generate your first 40-minute script.
          </p>
        )}
      </main>
    </div>
  );
}
