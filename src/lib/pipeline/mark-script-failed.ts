import { getServiceClient } from "@/lib/db/service-client";

export async function markScriptFailed(scriptId: string, message: string): Promise<void> {
  const supabase = getServiceClient();
  const errorMessage = message.slice(0, 4000);

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
