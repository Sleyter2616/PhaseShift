import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { collectWordBudgetWarnings } from "../src/lib/contracts/manifest";
import { countAudioFilesForDedupeKeys } from "../src/lib/pipeline/dedupe-plan";
import {
  checkIntakeStringsVerbatim,
  checkPhaseTimingClosure,
  countBannedTokensInTheta,
  findLongScheduledPauses,
  formatBannedTokenWarning,
  parseOveragePhases,
} from "../src/lib/pipeline/phase1-verify";
import { resolveSynthesisIdentity } from "../src/lib/pipeline/synthesis-identity";
import { PHASES } from "../src/lib/schedule/reconcile";

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

function pass(label: string, ok: boolean, detail = ""): boolean {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  return ok;
}

async function main() {
  loadEnvLocal();
  const scriptId = process.argv[2];
  if (!scriptId) {
    console.error("Usage: tsx scripts/verify-phase1.ts <script_id>");
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

  let allPass = true;

  const { data: script } = await supabase
    .from("scripts")
    .select(
      "id, status, user_id, goal_version_id, compiler_input, error_message, provider, stock_voice_id, voice_profile_id, tts_model_id",
    )
    .eq("id", scriptId)
    .single();

  if (!script) {
    console.log("FAIL script not found");
    process.exit(1);
  }

  allPass &&= pass("status ready", script.status === "ready", script.status);

  const synthesisIdentity = resolveSynthesisIdentity(script);
  const dedupeCtx = {
    userId: script.user_id,
    assetScope: synthesisIdentity.assetScope,
  };

  const { data: segments } = await supabase
    .from("script_segments")
    .select("*")
    .eq("script_id", scriptId)
    .order("seq");

  const segs = segments ?? [];
  allPass &&= pass("≥15 segments", segs.length >= 15, String(segs.length));

  const thetaSegs = segs.filter((s) => s.phase === "theta");
  const thetaSteps = thetaSegs.map((s) => s.step).filter((s): s is number => s != null);
  const uniqueSteps: number[] = [];
  for (const step of thetaSteps) {
    if (uniqueSteps.at(-1) !== step) uniqueSteps.push(step);
  }
  const expected = Array.from({ length: 12 }, (_, i) => i + 1);
  allPass &&= pass(
    "theta steps 1..12 in order",
    uniqueSteps.join(",") === expected.join(","),
    uniqueSteps.join(","),
  );

  const { data: goalVersion } = await supabase
    .from("goal_versions")
    .select("localization_timeframe, localization_place, triangulation, not_list, features, sync_actions, goal_id")
    .eq("id", script.goal_version_id)
    .single();

  const { data: goal } = await supabase
    .from("goals")
    .select("raw_statement")
    .eq("id", goalVersion?.goal_id ?? "")
    .maybeSingle();

  const concatText = segs.map((s) => s.text).join("\n");
  const stringsToFind: string[] = [];
  if (goalVersion) {
    stringsToFind.push(
      goalVersion.localization_timeframe,
      goalVersion.localization_place,
      ...(goalVersion.triangulation as string[]),
      ...(goalVersion.not_list as string[]),
      ...(goalVersion.features as string[]),
      ...((goalVersion.sync_actions as { action: string }[]) ?? []).map((a) => a.action),
    );
  }
  if (goal?.raw_statement) stringsToFind.push(goal.raw_statement);

  const verbatim = checkIntakeStringsVerbatim(concatText, stringsToFind);
  const verbatimLabel = verbatim.caseNormalized
    ? "intake strings verbatim in segment text (case-normalized)"
    : "intake strings verbatim in segment text";
  allPass &&= pass(
    verbatimLabel,
    verbatim.ok,
    verbatim.ok ? "" : `missing: ${verbatim.missing.slice(0, 3).join(" | ")}`,
  );

  const phaseBudget = (
    script.compiler_input as { session?: { phase_budget_sec?: Record<string, number> } }
  )?.session?.phase_budget_sec;

  const overagePhases = parseOveragePhases(script.error_message);

  if (phaseBudget) {
    for (const phase of PHASES) {
      const sum = segs.filter((s) => s.phase === phase).reduce((a, s) => a + s.target_duration_sec, 0);
      const budget = phaseBudget[phase];
      allPass &&= pass(`phase ${phase} target_duration sum`, sum === budget, `${sum} vs ${budget}`);
    }

    for (const phase of PHASES) {
      const phaseSegs = segs.filter((s) => s.phase === phase);
      if (phaseSegs.length === 0) continue;
      const budget = phaseBudget[phase];
      if (budget == null) continue;

      const timing = checkPhaseTimingClosure(phaseSegs, budget, overagePhases.has(phase));
      allPass &&= pass(`phase ${phase} timing closure`, timing.ok, timing.detail);
    }
  } else {
    allPass &&= pass("compiler_input phase_budget_sec present", false);
  }

  const notReady = segs.filter((s) => s.synthesis_status !== "ready" || !s.audio_file_id);
  allPass &&= pass(
    "all segments ready with audio_file_id",
    notReady.length === 0,
    notReady.length ? `${notReady.length} incomplete` : "",
  );

  for (const phase of PHASES) {
    const phaseSegs = segs.filter((s) => s.phase === phase);
    if (phaseSegs.length === 0) continue;
    const negatives = phaseSegs.filter((s) => (s.scheduled_pause_after_ms ?? 0) < 0);
    allPass &&= pass(`phase ${phase} scheduled_pause_after_ms ≥ 0`, negatives.length === 0);
  }

  for (const longPause of findLongScheduledPauses(segs)) {
    console.log(`WARN scheduled_pause_after_ms > 30s: seq ${longPause.seq} (${longPause.ms}ms)`);
  }

  const thetaText = thetaSegs.map((s) => s.text).join(" ");
  console.log(formatBannedTokenWarning(countBannedTokensInTheta(thetaText)));

  const wordBudgetWarnings = collectWordBudgetWarnings(segs);
  console.log(`WARN word-budget: ${wordBudgetWarnings.length} segment(s) exceed advisory ceiling`);
  for (const warning of wordBudgetWarnings) {
    console.log(`WARN ${warning}`);
  }

  const dedupeKeys = [...new Set(segs.map((s) => s.content_hash))];
  const audioCount = await countAudioFilesForDedupeKeys(supabase, dedupeCtx, dedupeKeys);

  allPass &&= pass(
    "audio_files rows for dedupe keys",
    audioCount >= dedupeKeys.length,
    `count=${audioCount} keys=${dedupeKeys.length} scope=${dedupeCtx.assetScope}`,
  );

  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
