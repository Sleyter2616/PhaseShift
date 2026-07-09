"use server";

import { getServiceClient } from "@/lib/db/service-client";

function devUserId(): string {
  const userId = process.env.DEV_USER_ID;
  if (!userId) throw new Error("DEV_USER_ID is not configured");
  return userId;
}

export async function createSession(scriptId: string): Promise<{ sessionId: string }> {
  const supabase = getServiceClient();
  const userId = devUserId();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: userId,
      script_id: scriptId,
      progress_sec: 0,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "failed to create session");
  }

  return { sessionId: data.id };
}

export async function completeSession(input: {
  sessionId: string;
  progressSec: number;
  exitAlertness: number;
}): Promise<void> {
  if (input.exitAlertness < 1 || input.exitAlertness > 5) {
    throw new Error("exit_alertness must be between 1 and 5");
  }

  const supabase = getServiceClient();
  const userId = devUserId();

  const { error } = await supabase
    .from("sessions")
    .update({
      completed_at: new Date().toISOString(),
      progress_sec: Math.max(0, Math.round(input.progressSec)),
      exit_alertness: input.exitAlertness,
    })
    .eq("id", input.sessionId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}
