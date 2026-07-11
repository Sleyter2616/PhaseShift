"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { intake40Min } from "@/lib/fixtures/intake";

export function DevGoldenScriptButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newScriptId, setNewScriptId] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setInsufficientCredits(false);
    setError(null);
    setNewScriptId(null);

    try {
      const response = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intake40Min),
      });

      const body: { script_id?: string; error?: string | object } = await response
        .json()
        .catch(() => ({}));

      if (response.status === 202 && body.script_id) {
        setNewScriptId(body.script_id);
        router.refresh();
        return;
      }

      if (response.status === 402) {
        setInsufficientCredits(true);
        return;
      }

      const errorText =
        typeof body.error === "string"
          ? body.error
          : body.error != null
            ? JSON.stringify(body.error)
            : response.statusText || "request failed";
      setError(errorText);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => void handleClick()}
        className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
      >
        {pending ? "Starting…" : "Dev: golden intake (40 min)"}
      </button>
      {insufficientCredits ? (
        <p className="text-sm text-amber-700">Insufficient credits</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {newScriptId ? (
        <p className="text-sm text-neutral-700">
          Started script{" "}
          <code className="rounded bg-neutral-100 px-1 font-mono text-xs">{newScriptId}</code>{" "}
          —{" "}
          <Link href={`/dev/scripts/${newScriptId}`} className="underline">
            view status
          </Link>
        </p>
      ) : null}
    </div>
  );
}
