"use client";

import { useState } from "react";
import { MINUTE_TIERS, TOPUP_MINUTES, type MinutesTierId } from "@/lib/billing/minutes";

type CheckoutKind = "topup" | "subscribe";

async function postBilling(path: string, body?: unknown): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as { url?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `request failed (${response.status})`);
  }
  if (!data.url) throw new Error("missing checkout url");
  return data.url;
}

export function BillingActions({
  subscriptionStatus,
}: {
  subscriptionStatus: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscribed = subscriptionStatus === "active" || subscriptionStatus === "past_due";

  async function startCheckout(kind: CheckoutKind, tier?: MinutesTierId) {
    const key = tier ? `${kind}:${tier}` : kind;
    setPending(key);
    setError(null);
    try {
      const url = await postBilling("/api/billing/checkout", { kind, tier });
      window.location.href = url;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "checkout failed");
      setPending(null);
    }
  }

  async function openPortal() {
    setPending("portal");
    setError(null);
    try {
      const url = await postBilling("/api/billing/portal");
      window.location.href = url;
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : "portal failed");
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => startCheckout("topup")}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending === "topup"
            ? "Redirecting…"
            : `Buy top-up ($${TOPUP_MINUTES.priceUsd} = ${TOPUP_MINUTES.minutes} min)`}
        </button>
        {(Object.keys(MINUTE_TIERS) as MinutesTierId[]).map((tier) => {
          const plan = MINUTE_TIERS[tier];
          return (
            <button
              key={tier}
              type="button"
              disabled={pending !== null || subscribed}
              onClick={() => startCheckout("subscribe", tier)}
              className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending === `subscribe:${tier}`
                ? "Redirecting…"
                : `${plan.label} — $${plan.priceUsd}/mo (${plan.monthlyMinutes} min/mo)`}
            </button>
          );
        })}
        {subscribed ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={openPortal}
            className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {pending === "portal" ? "Opening…" : "Manage billing"}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
