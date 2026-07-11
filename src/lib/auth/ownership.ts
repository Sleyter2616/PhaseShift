import type { SupabaseClient } from "@supabase/supabase-js";

export async function userOwnsScript(
  supabase: SupabaseClient,
  scriptId: string,
): Promise<boolean> {
  const { data } = await supabase.from("scripts").select("id").eq("id", scriptId).maybeSingle();
  return data != null;
}
