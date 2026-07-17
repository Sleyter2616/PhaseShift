import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Mark } from "@/components/mark";
import { SetupHeader } from "@/components/setup-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 2;

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export default async function DevScriptStatusPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const { data: script } = await supabase
    .from("scripts")
    .select("id, status, error_message, total_duration_sec, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!script) {
    notFound();
  }

  const { data: segments } = await supabase
    .from("script_segments")
    .select("phase, synthesis_status, seq")
    .eq("script_id", id)
    .order("seq");

  const phaseRollup = ["beta", "alpha", "theta", "gamma"].map((phase) => {
    const phaseSegments = (segments ?? []).filter((segment) => segment.phase === phase);
    const statusCounts = phaseSegments.reduce<Record<string, number>>((acc, segment) => {
      acc[segment.synthesis_status] = (acc[segment.synthesis_status] ?? 0) + 1;
      return acc;
    }, {});
    return { phase, total: phaseSegments.length, statusCounts };
  });

  const isReady = script.status === "ready";

  return (
    <div className="setup-ground min-h-dvh">
      <SetupHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
        <AutoRefresh />

        <header className="space-y-3">
          <p className="step-eyebrow">Generation status</p>
          <div className="flex items-start gap-3">
            <Mark size={28} className={isReady ? undefined : "loading-mark"} />
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-normal text-[var(--text-hi)]">
                Script status
              </h1>
              <p className="mt-1 truncate font-mono text-xs text-[var(--text-mid)]">{id}</p>
            </div>
          </div>
        </header>

        <section className="setup-panel space-y-4 p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--text-mid)]">Status</dt>
              <dd className="mt-1 text-sm font-medium text-[var(--text-hi)]">
                {formatStatus(script.status)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-mid)]">Duration</dt>
              <dd className="mt-1 text-sm text-[var(--text-hi)]">
                {script.total_duration_sec != null
                  ? `${Math.round(script.total_duration_sec / 60)} min (${script.total_duration_sec}s)`
                  : "—"}
              </dd>
            </div>
          </dl>

          {script.error_message ? (
            <p className="text-warning text-sm">
              <span className="font-medium">Error:</span> {script.error_message}
            </p>
          ) : null}

          {isReady ? (
            <Link href={`/session/${id}`} className="btn-clay inline-flex px-5 py-2.5">
              Play session
            </Link>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-normal text-[var(--text-hi)]">Phases</h2>
          <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--setup-border)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--setup-border)] bg-[var(--setup-panel)]">
                  <th className="px-4 py-2.5 text-left font-medium text-[var(--text-mid)]">
                    Phase
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[var(--text-mid)]">
                    Segments
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[var(--text-mid)]">
                    Synthesis
                  </th>
                </tr>
              </thead>
              <tbody>
                {phaseRollup.map((row) => (
                  <tr key={row.phase} className="border-b border-[var(--setup-border)] last:border-b-0">
                    <td className="px-4 py-2.5 capitalize text-[var(--text-hi)]">{row.phase}</td>
                    <td className="px-4 py-2.5 text-[var(--text-mid)]">{row.total}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-mid)]">
                      {Object.entries(row.statusCounts)
                        .map(([status, count]) => `${status}:${count}`)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--text-lo)]">Auto-refresh every 2s</p>
        </section>

        <p>
          <Link href="/scripts" className="btn-link">
            Back to sessions
          </Link>
        </p>
      </main>
    </div>
  );
}
