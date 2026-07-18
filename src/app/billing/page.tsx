import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { SUBSCRIPTION_TIERS } from "@/lib/billing/plans";
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
      "credit_balance, subscription_status, subscription_tier, subscription_current_period_end",
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
    profile?.subscription_tier &&
    profile.subscription_tier in SUBSCRIPTION_TIERS
      ? SUBSCRIPTION_TIERS[profile.subscription_tier as keyof typeof SUBSCRIPTION_TIERS].label
      : "None";

  return (
    <>
      <AuthHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Billing</h1>

        <section className="rounded border border-neutral-200 p-4">
          <h2 className="text-sm font-medium text-neutral-500">Credit balance</h2>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {profile?.credit_balance ?? 0}
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
