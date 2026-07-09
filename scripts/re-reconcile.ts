import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { reconcileSegments } from "../src/lib/pipeline/reconcile-persist";
import { PHASES, type PhaseKey } from "../src/lib/schedule/reconcile";

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const scriptId = process.argv[2];
  if (!scriptId) {
    console.error("Usage: pnpm re:reconcile <script_id>");
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

  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("id, status, compiler_input, error_message")
    .eq("id", scriptId)
    .single();

  if (scriptError || !script) {
    console.error(`script not found: ${scriptError?.message ?? scriptId}`);
    process.exit(1);
  }

  const phaseBudget = (
    script.compiler_input as { session?: { phase_budget_sec?: Record<PhaseKey, number> } }
  )?.session?.phase_budget_sec;

  if (!phaseBudget) {
    console.error("compiler_input.phase_budget_sec missing");
    process.exit(1);
  }

  const { data: segments, error: segmentError } = await supabase
    .from("script_segments")
    .select("id, phase, seq, pause_after_ms, actual_duration_sec, scheduled_pause_after_ms")
    .eq("script_id", scriptId)
    .order("seq");

  if (segmentError) {
    console.error(segmentError.message);
    process.exit(1);
  }

  const segs = segments ?? [];
  const { updates, overBudgetPhases } = reconcileSegments(segs, phaseBudget);

  for (const update of updates) {
    const { error } = await supabase
      .from("script_segments")
      .update({ scheduled_pause_after_ms: update.scheduled_pause_after_ms })
      .eq("id", update.id);
    if (error) {
      console.error(`segment update failed: ${error.message}`);
      process.exit(1);
    }
  }

  const { data: refreshed, error: refreshError } = await supabase
    .from("script_segments")
    .select("actual_duration_sec, scheduled_pause_after_ms, phase, synthesis_status")
    .eq("script_id", scriptId);

  if (refreshError) {
    console.error(refreshError.message);
    process.exit(1);
  }

  const totalDurationSec = Math.round(
    (refreshed ?? []).reduce(
      (sum, row) =>
        sum +
        Number(row.actual_duration_sec ?? 0) +
        Number(row.scheduled_pause_after_ms ?? 0) / 1000,
      0,
    ),
  );

  let overageWarning: string | null = script.error_message ?? null;
  if (overBudgetPhases.length > 0) {
    overageWarning = `OVERAGE: phases ${overBudgetPhases.join(",")} exceed voiced budget by >2%`;
  } else if (overageWarning?.startsWith("OVERAGE:")) {
    overageWarning = null;
  }

  const allSegmentsReady =
    (refreshed ?? []).length > 0 &&
    (refreshed ?? []).every((segment) => segment.synthesis_status === "ready");

  const scriptUpdate: {
    total_duration_sec: number;
    error_message: string | null;
    status?: "ready";
  } = {
    total_duration_sec: totalDurationSec,
    error_message: overageWarning,
  };

  if (allSegmentsReady) {
    scriptUpdate.status = "ready";
  }

  const { error: scriptUpdateError } = await supabase
    .from("scripts")
    .update(scriptUpdate)
    .eq("id", scriptId);

  if (scriptUpdateError) {
    console.error(scriptUpdateError.message);
    process.exit(1);
  }

  const finalStatus = allSegmentsReady ? "ready" : script.status;

  console.log(`re-reconciled script ${scriptId}`);
  console.log(`status=${finalStatus}`);
  console.log(`total_duration_sec=${totalDurationSec}`);
  if (overBudgetPhases.length > 0) {
    console.log(`OVERAGE phases: ${overBudgetPhases.join(",")}`);
  }

  for (const phase of PHASES) {
    const phaseSegs = (refreshed ?? []).filter((s) => s.phase === phase);
    if (phaseSegs.length === 0) continue;
    const voicedSec = phaseSegs.reduce((sum, s) => sum + Number(s.actual_duration_sec ?? 0), 0);
    const pauseSec = phaseSegs.reduce(
      (sum, s) => sum + Number(s.scheduled_pause_after_ms ?? 0) / 1000,
      0,
    );
    const budget = phaseBudget[phase];
    console.log(
      `phase ${phase}: voiced=${voicedSec.toFixed(1)}s pause=${pauseSec.toFixed(1)}s total=${(voicedSec + pauseSec).toFixed(1)}s budget=${budget}s`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
