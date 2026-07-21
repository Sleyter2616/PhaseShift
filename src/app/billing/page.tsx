import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { MINUTE_TIERS } from "@/lib/billing/minutes";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BillingActions } from "./billing-actions";

function formatPeriodEnd(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export default async function BillingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "subscription_minutes, topup_minutes, subscription_minutes_reset_at, subscription_status, subscription_tier, subscription_current_period_end",
    )
    .eq("id", user.id)
    .single();

  if (error) {
    return (
      <>
        <AuthHeader />
        <main className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-red-700">Failed to load billing: {error.message}</p>
        </main>
      </>
    );
  }

  const tierLabel =
    profile?.subscription_tier && profile.subscription_tier in MINUTE_TIERS
      ? MINUTE_TIERS[profile.subscription_tier as keyof typeof MINUTE_TIERS].label
      : "None";

  const subscriptionMinutes = Number(profile?.subscription_minutes ?? 0);
  const topupMinutes = Number(profile?.topup_minutes ?? 0);

  return (
    <>
      <AuthHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Billing</h1>

        <section className="rounded border border-neutral-200 p-4">
          <h2 className="text-sm font-medium text-neutral-500">Minutes balance</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-neutral-500">Subscription</dt>
              <dd className="text-2xl font-semibold tabular-nums">{subscriptionMinutes}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Top-up</dt>
              <dd className="text-2xl font-semibold tabular-nums">{topupMinutes}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Total</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {subscriptionMinutes + topupMinutes}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-neutral-600">
            Subscription minutes reset {formatPeriodEnd(profile?.subscription_minutes_reset_at ?? null)}
            . Top-up minutes never expire.
          </p>
        </section>

        <section className="rounded border border-neutral-200 p-4">
          <h2 className="text-sm font-medium text-neutral-500">Subscription</h2>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-500">Status</dt>
              <dd className="font-medium capitalize">{profile?.subscription_status ?? "none"}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Tier</dt>
              <dd className="font-medium">{tierLabel}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Current period ends</dt>
              <dd className="font-medium">
                {formatPeriodEnd(profile?.subscription_current_period_end ?? null)}
              </dd>
            </div>
          </dl>
        </section>

        <BillingActions subscriptionStatus={profile?.subscription_status ?? "none"} />
      </main>
    </>
  );
}
