import { getServiceClient } from "@/lib/db/service-client";

export const revalidate = 2;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DevScriptStatusPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = getServiceClient();

  const { data: script } = await supabase
    .from("scripts")
    .select("id, status, error_message, total_duration_sec, created_at")
    .eq("id", id)
    .maybeSingle();

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

  return (
    <main className="mx-auto max-w-3xl p-6 font-mono text-sm">
      <meta httpEquiv="refresh" content="2" />
      <h1 className="mb-4 text-lg font-semibold">Script {id}</h1>
      {!script ? (
        <p>Not found</p>
      ) : (
        <div className="space-y-3">
          <p>
            <strong>status:</strong> {script.status}
          </p>
          <p>
            <strong>total_duration_sec:</strong> {script.total_duration_sec ?? "—"}
          </p>
          {script.error_message ? (
            <p className="text-amber-700">
              <strong>error_message:</strong> {script.error_message}
            </p>
          ) : null}
          <table className="w-full border-collapse border border-neutral-300">
            <thead>
              <tr>
                <th className="border border-neutral-300 p-2 text-left">phase</th>
                <th className="border border-neutral-300 p-2 text-left">segments</th>
                <th className="border border-neutral-300 p-2 text-left">synthesis_status</th>
              </tr>
            </thead>
            <tbody>
              {phaseRollup.map((row) => (
                <tr key={row.phase}>
                  <td className="border border-neutral-300 p-2">{row.phase}</td>
                  <td className="border border-neutral-300 p-2">{row.total}</td>
                  <td className="border border-neutral-300 p-2">
                    {Object.entries(row.statusCounts)
                      .map(([status, count]) => `${status}:${count}`)
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-neutral-500">Auto-refresh every 2s</p>
        </div>
      )}
    </main>
  );
}
