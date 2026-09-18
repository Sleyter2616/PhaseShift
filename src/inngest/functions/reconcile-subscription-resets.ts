import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import { capturePathError } from "@/lib/sentry/capture";
import {
  listStaleSubscriptionResetUserIds,
  reconcileStaleSubscriptionReset,
} from "@/lib/billing/reconcile-subscription-reset";

/**
 * Hourly fallback: profiles whose subscription_minutes_reset_at is in the past
 * are checked against Stripe. Paid-active → grant_subscription_minutes (same
 * as invoice.paid). Lapsed → clear the stale date, no complimentary minutes.
 */
export const reconcileSubscriptionResets = inngest.createFunction(
  {
    id: "reconcile-subscription-resets",
    retries: 1,
    triggers: [{ cron: "20 * * * *" }],
  },
  async ({ step }) => {
    const userIds = await step.run("list-stale-reset-profiles", async () => {
      return listStaleSubscriptionResetUserIds(getServiceClient());
    });

    const summary = { granted: 0, cleared: 0, skipped: 0, current: 0, errors: 0 };

    for (const userId of userIds) {
      const result = await step.run(`reconcile-${userId}`, async () => {
        try {
          return await reconcileStaleSubscriptionReset({
            userId,
            supabase: getServiceClient(),
          });
        } catch (error) {
          capturePathError(error, "billing.reconcile_subscription_reset");
          throw error;
        }
      });

      if (result.action === "granted") summary.granted += 1;
      else if (result.action === "cleared_stale_date" || result.action === "skipped_unpaid") {
        summary.cleared += 1;
      } else if (result.action === "current") summary.current += 1;
      else summary.skipped += 1;
    }

    console.error(
      `subscription-reset-reconcile: scanned=${userIds.length} granted=${summary.granted} ` +
        `cleared=${summary.cleared} current=${summary.current} skipped=${summary.skipped}`,
    );
    return { scanned: userIds.length, ...summary };
  },
);
