import { z } from "zod";
import { NextResponse } from "next/server";
import { assertDevAuth, DevAuthError, devAuthErrorResponse } from "@/lib/auth/dev-secret";
import { intakeSchema } from "@/lib/contracts/intake";
import { PROMPT_VERSION } from "@/lib/compiler/prompt.v1.3";
import { getServiceClient } from "@/lib/db/service-client";
import { inngest } from "@/inngest/client";
import { buildCompilerInput } from "@/lib/session/derive";

export async function POST(request: Request) {
  try {
    const userId = assertDevAuth(request);
    const body: unknown = await request.json();
    const intake = intakeSchema.parse(body);
    const supabase = getServiceClient();

    const title = intake.goal_statement.slice(0, 80);
    let goalId: string;

    const { data: existingGoal } = await supabase
      .from("goals")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title)
      .maybeSingle();

    if (existingGoal?.id) {
      goalId = existingGoal.id;
    } else {
      const { data: newGoal, error: goalError } = await supabase
        .from("goals")
        .insert({
          user_id: userId,
          title,
          raw_statement: intake.goal_statement,
          aos_layer: intake.session.aos_layer ?? null,
        })
        .select("id")
        .single();

      if (goalError || !newGoal) {
        return NextResponse.json({ error: goalError?.message ?? "goal insert failed" }, { status: 500 });
      }
      goalId = newGoal.id;
    }

    const { data: versionRow } = await supabase
      .from("goal_versions")
      .select("version")
      .eq("goal_id", goalId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (versionRow?.version ?? 0) + 1;

    const { data: goalVersion, error: gvError } = await supabase
      .from("goal_versions")
      .insert({
        goal_id: goalId,
        version: nextVersion,
        localization_timeframe: intake.localization.timeframe,
        localization_place: intake.localization.place,
        triangulation: intake.triangulation,
        not_list: intake.not_list,
        wrong_direction_pulls: intake.wrong_pulls,
        features: intake.features,
        sync_actions: intake.sync_actions,
      })
      .select("id")
      .single();

    if (gvError || !goalVersion) {
      return NextResponse.json({ error: gvError?.message ?? "goal_version insert failed" }, { status: 500 });
    }

    const compilerInput = buildCompilerInput(intake, goalVersion.id);
    const llmModel = process.env.LLM_MODEL ?? "claude-sonnet-4-6";

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .insert({
        user_id: userId,
        goal_version_id: goalVersion.id,
        status: "generating",
        prompt_version: PROMPT_VERSION,
        llm_model: llmModel,
        entrainment_mode: intake.session.entrainment_mode,
        stock_voice_id: "mock-voice",
        compiler_input: compilerInput,
      })
      .select("id")
      .single();

    if (scriptError || !script) {
      return NextResponse.json({ error: scriptError?.message ?? "script insert failed" }, { status: 500 });
    }

    await inngest.send({
      name: "script/generate.requested",
      data: { script_id: script.id },
    });

    return NextResponse.json({ script_id: script.id }, { status: 202 });
  } catch (error) {
    if (error instanceof DevAuthError) {
      return devAuthErrorResponse();
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
