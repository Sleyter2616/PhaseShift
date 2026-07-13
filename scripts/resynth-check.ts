import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  applyDedupeHits,
  countAudioFilesForDedupeKeys,
  planSegmentDedupe,
} from "../src/lib/pipeline/dedupe-plan";
import { resynthPreconditionError } from "../src/lib/pipeline/resynth-guard";
import { runSynthesizeSegment } from "../src/lib/pipeline/synthesize-segment-job";
import { loadScriptSynthesisIdentity } from "../src/lib/pipeline/synthesis-identity";

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
    console.error("Usage: tsx scripts/resynth-check.ts <script_id>");
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

  const { data: script } = await supabase
    .from("scripts")
    .select("id, user_id, status, provider, stock_voice_id, voice_profile_id, tts_model_id")
    .eq("id", scriptId)
    .single();

  if (!script) {
    console.log("FAIL script not found");
    process.exit(1);
  }

  const synthesisIdentity = await loadScriptSynthesisIdentity(supabase, script);
  const dedupeCtx = {
    userId: script.user_id,
    assetScope: synthesisIdentity.assetScope,
  };

  const { data: segments } = await supabase
    .from("script_segments")
    .select("id, content_hash, text, pacing_wpm, seq")
    .eq("script_id", scriptId)
    .order("seq");

  const preconditionError = resynthPreconditionError(script.status, (segments ?? []).length);
  if (preconditionError) {
    console.log(preconditionError);
    process.exit(1);
  }

  const dedupeKeys = [...new Set((segments ?? []).map((s) => s.content_hash))];
  const beforeCount = await countAudioFilesForDedupeKeys(supabase, dedupeCtx, dedupeKeys);

  const plan = await planSegmentDedupe(supabase, dedupeCtx, segments ?? []);
  await applyDedupeHits(supabase, plan.hits);

  if (plan.misses.length > 0) {
    const ordered = [...(segments ?? [])].sort((a, b) => a.seq - b.seq);
    await Promise.all(
      plan.misses.map((miss) => {
        const orderedIndex = ordered.findIndex((segment) => segment.id === miss.segmentId);
        const previousText =
          orderedIndex > 0 ? ordered[orderedIndex - 1]?.text : undefined;
        const nextText =
          orderedIndex >= 0 && orderedIndex < ordered.length - 1
            ? ordered[orderedIndex + 1]?.text
            : undefined;

        return runSynthesizeSegment(supabase, {
          script_id: scriptId,
          segment_id: miss.segmentId,
          user_id: script.user_id,
          dedupe_key: miss.contentHash,
          text: miss.text,
          pacing_wpm: miss.pacingWpm,
          previous_text: previousText,
          next_text: nextText,
        });
      }),
    );
  }

  const afterCount = await countAudioFilesForDedupeKeys(supabase, dedupeCtx, dedupeKeys);

  const newRows = afterCount - beforeCount;
  const ok = newRows === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} resynth idempotency: ${newRows} new audio_files rows (hits=${plan.hits.length}, misses=${plan.misses.length}, scope=${dedupeCtx.assetScope})`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
