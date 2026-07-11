import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail?: string) {
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  process.exitCode = 1;
}

async function createUser(email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return data.user.id;
}

async function signIn(email: string, password: string) {
  const client = createClient(url!, anonKey!);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn failed: ${error.message}`);
  return client;
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const password = `test-${suffix}-pw`;
  const emailA = `rls-a-${suffix}@test.local`;
  const emailB = `rls-b-${suffix}@test.local`;
  let userAId = "";
  let userBId = "";
  let sharedAudioId: string | null = null;

  try {
    userAId = await createUser(emailA, password);
    userBId = await createUser(emailB, password);

    await admin.from("profiles").upsert({ id: userAId, credit_balance: 10 });
    await admin.from("profiles").upsert({ id: userBId, credit_balance: 10 });

    const clientA = await signIn(emailA, password);
    const clientB = await signIn(emailB, password);

    const { data: goalA, error: goalError } = await clientA
      .from("goals")
      .insert({
        user_id: userAId,
        title: `RLS goal ${suffix}`,
        raw_statement: "test goal",
      })
      .select("id")
      .single();
    if (goalError || !goalA) throw new Error(goalError?.message ?? "goal insert failed");

    const { data: gvA, error: gvError } = await clientA
      .from("goal_versions")
      .insert({
        goal_id: goalA.id,
        version: 1,
        localization_timeframe: "soon",
        localization_place: "here",
        triangulation: ["a", "b", "c"],
        not_list: ["x"],
        features: ["f1", "f2", "f3"],
        sync_actions: [{ action: "act" }],
      })
      .select("id")
      .single();
    if (gvError || !gvA) throw new Error(gvError?.message ?? "goal_version insert failed");

    const { data: scriptA, error: scriptError } = await clientA
      .from("scripts")
      .insert({
        user_id: userAId,
        goal_version_id: gvA.id,
        status: "generating",
        provider: "selfhost",
        stock_voice_id: "mock",
        compiler_input: {},
      })
      .select("id")
      .single();
    if (scriptError || !scriptA) throw new Error(scriptError?.message ?? "script insert failed");

    const { error: segmentError } = await clientA.from("script_segments").insert({
      user_id: userAId,
      script_id: scriptA.id,
      seq: 1,
      phase: "beta",
      text: "test segment",
      target_duration_sec: 10,
      pacing_wpm: 130,
      entrainment_hz: 18,
      content_hash: `hash-${suffix}`,
      synthesis_status: "pending",
    });
    if (segmentError) throw new Error(segmentError.message);

    const { count: bGoals } = await clientB
      .from("goals")
      .select("*", { count: "exact", head: true })
      .eq("id", goalA.id);
    if (bGoals === 0) pass("user B sees 0 of user A goals");
    else fail("user B sees 0 of user A goals", `count=${bGoals}`);

    const { count: bScripts } = await clientB
      .from("scripts")
      .select("*", { count: "exact", head: true })
      .eq("id", scriptA.id);
    if (bScripts === 0) pass("user B sees 0 of user A scripts");
    else fail("user B sees 0 of user A scripts", `count=${bScripts}`);

    const { count: bSegments } = await clientB
      .from("script_segments")
      .select("*", { count: "exact", head: true })
      .eq("script_id", scriptA.id);
    if (bSegments === 0) pass("user B sees 0 of user A segments");
    else fail("user B sees 0 of user A segments", `count=${bSegments}`);

    const { error: ledgerError } = await clientA.from("credit_ledger").insert({
      user_id: userAId,
      delta: 1,
      reason: "grant",
    });
    if (ledgerError && (ledgerError.code === "42501" || ledgerError.message.includes("row-level security"))) {
      pass("credit_ledger client insert blocked for user A");
    } else {
      fail("credit_ledger client insert blocked for user A", ledgerError?.message ?? "insert succeeded");
    }

    const { data: gvUpdate } = await clientA
      .from("goal_versions")
      .update({ version: 99 })
      .eq("id", gvA.id)
      .select("id");
    if (!gvUpdate || gvUpdate.length === 0) pass("goal_versions update as owner affects 0 rows");
    else fail("goal_versions update as owner affects 0 rows", `rows=${gvUpdate.length}`);

    const { data: sharedAudio, error: sharedError } = await admin
      .from("audio_files")
      .insert({
        asset_scope: "shared",
        provider: "selfhost",
        dedupe_key: `rls-shared-${suffix}`,
        storage_path: `shared/rls-${suffix}.mp3`,
      })
      .select("id")
      .single();
    if (sharedError || !sharedAudio) throw new Error(sharedError?.message ?? "shared audio insert failed");
    sharedAudioId = sharedAudio.id;

    const { data: aShared } = await clientA.from("audio_files").select("id").eq("id", sharedAudioId).maybeSingle();
    const { data: bShared } = await clientB.from("audio_files").select("id").eq("id", sharedAudioId).maybeSingle();
    if (aShared?.id && bShared?.id) pass("shared audio_files readable by both users");
    else fail("shared audio_files readable by both users");
  } finally {
    if (sharedAudioId) {
      await admin.from("audio_files").delete().eq("id", sharedAudioId);
    }
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
