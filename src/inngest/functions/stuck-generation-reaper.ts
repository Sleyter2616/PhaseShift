import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import { runStuckGenerationReaper } from "@/lib/pipeline/stuck-generation-reaper";
import { capturePathError } from "@/lib/sentry/capture";

/**
 * Reaps hard-killed generations left at status=generating (Vercel timeout /
 * crash) so spent minutes are refunded and the script is marked failed.
 * Runs every 5 minutes.
 */
export const stuckGenerationReaper = inngest.createFunction(
  {
    id: "stuck-generation-reaper",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    try {
      return await step.run("reap-stuck-generating", async () => {
        const results = await runStuckGenerationReaper(getServiceClient());
        return {
          reaped: results.length,
          scripts: results.map((r) => ({
            script_id: r.scriptId,
            age_ms: r.ageMs,
            minutes_refunded: r.minutesRefunded,
            already_refunded: r.alreadyRefunded,
          })),
        };
      });
    } catch (error) {
      capturePathError(error, "pipeline.stuck_generation_reaper");
      throw error;
    }
  },
);
