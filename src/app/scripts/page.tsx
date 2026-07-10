import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default async function ScriptsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: scripts, error } = await supabase
    .from("scripts")
    .select("id, status, total_duration_sec, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <>
        <AuthHeader />
        <main className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-red-700">Failed to load scripts: {error.message}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AuthHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Your scripts</h1>
        </div>

        {scripts && scripts.length > 0 ? (
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
            {scripts.map((script) => (
              <li key={script.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{script.id}</p>
                  <p className="text-xs text-neutral-500">
                    {script.status}
                    {script.total_duration_sec != null
                      ? ` · ${Math.round(script.total_duration_sec / 60)} min`
                      : ""}
                    {" · "}
                    {formatDate(script.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 text-sm">
                  {script.status === "ready" ? (
                    <Link
                      href={`/session/${script.id}`}
                      className="rounded bg-neutral-900 px-3 py-1.5 text-white"
                    >
                      Play
                    </Link>
                  ) : (
                    <Link
                      href={`/dev/scripts/${script.id}`}
                      className="rounded border border-neutral-300 px-3 py-1.5"
                    >
                      Status
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-600">
            No scripts yet. Request generation via{" "}
            <code className="rounded bg-neutral-100 px-1">POST /api/scripts</code> while signed in.
          </p>
        )}
      </main>
    </>
  );
}
