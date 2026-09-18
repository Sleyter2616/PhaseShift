import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import { markScriptFailed } from "@/lib/pipeline/mark-script-failed";
import { reapStuckScripts } from "@/lib/pipeline/reap-stuck-scripts";
import { capturePathError } from "@/lib/sentry/capture";

/**
 * Every 5 minutes:
 * - `generating` >10 min with 0 ready segments → fail + refund
 * - `synthesizing` >10 min with pending/processing/failed segments → re-enqueue
 *   those jobs; after 2 retriggers still stuck → fail + refund
 */
export const stuckScriptReaper = inngest.createFunction(
  {
    id: "stuck-script-reaper",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const actions = await step.run("reap-stuck-scripts", async () => {
      try {
        return await reapStuckScripts({
          supabase: getServiceClient(),
          sendSynthesize: async (input) => {
            await inngest.send({
              name: "script/synthesize-segment",
              data: input,
            });
          },
          markFailed: (scriptId, message) => markScriptFailed(scriptId, message),
        });
      } catch (error) {
        capturePathError(error, "pipeline.stuck_script_reaper");
        throw error;
      }
    });

    const summary = {
      failed_generating: 0,
      finalized: 0,
      retried: 0,
      failed_synthesis: 0,
      skipped: 0,
    };
    for (const action of actions) {
      if (action.action === "failed_generating") summary.failed_generating += 1;
      else if (action.action === "finalized") summary.finalized += 1;
      else if (action.action === "retried") summary.retried += 1;
      else if (action.action === "failed_synthesis") summary.failed_synthesis += 1;
      else summary.skipped += 1;
    }

    console.error(
      `stuck-script-reaper: scanned=${actions.length} generating_failed=${summary.failed_generating} ` +
        `retried=${summary.retried} finalized=${summary.finalized} ` +
        `synthesis_failed=${summary.failed_synthesis} skipped=${summary.skipped}`,
    );
    return { scanned: actions.length, ...summary };
  },
);
