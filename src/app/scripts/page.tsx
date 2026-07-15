import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupHeader } from "@/components/setup-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DevGoldenScriptButton } from "./dev-golden-script-button";
import { NewScriptButton } from "./new-script-button";
import { synthesisProvenanceBadge } from "@/lib/synthesis/provenance";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "";
  return `${Math.round(sec / 60)} min`;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
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
      <div className="setup-ground min-h-dvh">
        <SetupHeader />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <p className="text-error">Failed to load scripts: {error.message}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="setup-ground min-h-dvh">
      <SetupHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="font-display text-2xl font-normal text-[var(--text-hi)]">
            Your sessions
          </h1>
          <div className="flex flex-col gap-2 sm:items-end">
            <NewScriptButton />
            {process.env.NODE_ENV === "development" ? <DevGoldenScriptButton /> : null}
          </div>
        </div>

        {scripts && scripts.length > 0 ? (
          <ul className="overflow-hidden rounded-[var(--radius)] border border-[var(--setup-border)]">
            {scripts.map((script) => (
              <li key={script.id} className="list-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--text-hi)]">
                      {script.id}
                    </p>
                    <span className="provider-badge">{synthesisProvenanceBadge(script)}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-mid)]">
                    {formatStatus(script.status)}
                    {script.total_duration_sec != null
                      ? ` · ${formatDuration(script.total_duration_sec)}`
                      : ""}
                    {" · "}
                    {formatDate(script.created_at)}
                  </p>
                </div>
                <div className="shrink-0">
                  {script.status === "ready" ? (
                    <Link href={`/session/${script.id}`} className="btn-clay px-4 py-1.5 text-sm">
                      Play
                    </Link>
                  ) : (
                    <Link href={`/dev/scripts/${script.id}`} className="btn-ghost px-4 py-1.5 text-sm">
                      Status
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-mid)]">
            No sessions yet.{" "}
            <Link href="/wizard" className="btn-link">
              Start the intake wizard
            </Link>{" "}
            to generate your first 40-minute script.
          </p>
        )}
      </main>
    </div>
  );
}
