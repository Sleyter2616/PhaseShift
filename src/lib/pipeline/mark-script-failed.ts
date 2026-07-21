import { getServiceClient } from "@/lib/db/service-client";
import { refundMinutesForFailedScript } from "@/lib/billing/refund-minutes";
import { capturePathError } from "@/lib/sentry/capture";

export async function markScriptFailed(scriptId: string, message: string): Promise<void> {
  const supabase = getServiceClient();
  const errorMessage = message.slice(0, 4000);

  const { data: script } = await supabase
    .from("scripts")
    .select("user_id")
    .eq("id", scriptId)
    .maybeSingle();

  if (script?.user_id) {
    try {
      await refundMinutesForFailedScript(supabase, script.user_id, scriptId);
    } catch (refundError) {
      capturePathError(refundError, "pipeline.mark_script_failed.refund");
      console.error("minutes refund on script failure failed", {
        scriptId,
        error: refundError instanceof Error ? refundError.message : refundError,
      });
    }
  }

  await supabase
    .from("scripts")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", scriptId);

  await supabase
    .from("script_segments")
    .update({ synthesis_status: "failed" })
    .eq("script_id", scriptId)
    .neq("synthesis_status", "ready");
}
