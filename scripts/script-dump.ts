import { createClient } from "@supabase/supabase-js";
import { formatScriptDump, type DumpSegment } from "../src/lib/review/script-dump";
import { loadEnvLocal } from "./load-env";

async function main() {
  loadEnvLocal();
  const scriptId = process.argv[2];
  if (!scriptId) {
    console.error("Usage: pnpm script:dump <script_id>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("script_segments")
    .select(
      "seq, phase, step, title, pacing_wpm, target_duration_sec, actual_duration_sec, pause_after_ms, scheduled_pause_after_ms, text",
    )
    .eq("script_id", scriptId)
    .order("seq", { ascending: true });

  if (error) {
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  }
  if (!data?.length) {
    console.error(`No segments found for script ${scriptId}`);
    process.exit(1);
  }

  const segments: DumpSegment[] = data.map((row) => ({
    seq: row.seq,
    phase: row.phase,
    step: row.step,
    title: row.title,
    pacing_wpm: row.pacing_wpm,
    target_duration_sec: row.target_duration_sec,
    actual_duration_sec: row.actual_duration_sec,
    pause_after_ms: row.pause_after_ms,
    scheduled_pause_after_ms: row.scheduled_pause_after_ms,
    text: row.text,
  }));

  console.log(formatScriptDump(segments, { scriptId }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
