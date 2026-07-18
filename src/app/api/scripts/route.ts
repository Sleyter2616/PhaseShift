import { z } from "zod";
import { NextResponse } from "next/server";
import { isInsufficientCreditsError } from "@/lib/auth/session";
import { creditsPerGeneration } from "@/lib/billing/plans";
import { createScriptBodySchema } from "@/lib/contracts/intake";
import { PROMPT_VERSION } from "@/lib/compiler/prompt.v1.4";
import { getServiceClient } from "@/lib/db/service-client";
import { inngest } from "@/inngest/client";
import { buildCompilerInput } from "@/lib/session/derive";
import {
  defaultTtsModelIdForScript,
  defaultTtsProvider,
} from "@/lib/pipeline/synthesis-identity";
import { createClient } from "@/lib/supabase/server";
import { isMockProviderVoiceId } from "@/lib/voice/process-voice-sample";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const userId = user.id;
    const body: unknown = await request.json();
    const parsed = createScriptBodySchema.parse(body);
    const { voice_profile_id: requestedVoiceProfileId, ...intake } = parsed;

    const provider = defaultTtsProvider();
    const stockVoiceId =
      provider === "selfhost"
        ? (process.env.ELEVENLABS_STOCK_VOICE_ID ?? "mock-voice")
        : process.env.ELEVENLABS_STOCK_VOICE_ID;

    let voiceProfileId: string | null = null;
    let scriptStockVoiceId: string | null = stockVoiceId ?? null;

    if (requestedVoiceProfileId) {
      const { data: voiceProfile, error: voiceProfileError } = await supabase
        .from("voice_profiles")
        .select("id, status, provider_voice_id")
        .eq("id", requestedVoiceProfileId)
        .eq("status", "ready")
        .maybeSingle();

      if (voiceProfileError) {
        return NextResponse.json({ error: voiceProfileError.message }, { status: 500 });
      }
      if (
        !voiceProfile?.id ||
        !voiceProfile.provider_voice_id ||
        isMockProviderVoiceId(voiceProfile.provider_voice_id)
      ) {
        return NextResponse.json({ error: "invalid voice_profile_id" }, { status: 400 });
      }
      voiceProfileId = voiceProfile.id;
      scriptStockVoiceId = null;
    } else if (!scriptStockVoiceId) {
      return NextResponse.json(
        { error: "ELEVENLABS_STOCK_VOICE_ID is required when TTS_PROVIDER=elevenlabs" },
        { status: 500 },
      );
    }

    const ttsModelId = defaultTtsModelIdForScript(voiceProfileId);
    const generationCost = creditsPerGeneration(ttsModelId);

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
        provider,
        stock_voice_id: scriptStockVoiceId,
        voice_profile_id: voiceProfileId,
        tts_model_id: ttsModelId,
        prompt_version: PROMPT_VERSION,
        llm_model: llmModel,
        entrainment_mode: intake.session.entrainment_mode,
        compiler_input: compilerInput,
      })
      .select("id")
      .single();

    if (scriptError || !script) {
      return NextResponse.json({ error: scriptError?.message ?? "script insert failed" }, { status: 500 });
    }

    const { error: spendError } = await supabase.rpc("spend_credits", {
      p_script: script.id,
      p_amount: generationCost,
      p_reason: "generation",
    });

    if (spendError) {
      if (isInsufficientCreditsError(spendError)) {
        await supabase
          .from("scripts")
          .update({ status: "failed", error_message: "insufficient_credits" })
          .eq("id", script.id);
        return NextResponse.json({ error: "insufficient_credits" }, { status: 402 });
      }
      return NextResponse.json({ error: spendError.message }, { status: 500 });
    }

    try {
      await inngest.send({
        name: "script/generate.requested",
        data: { script_id: script.id },
      });
    } catch (enqueueError) {
      const message =
        enqueueError instanceof Error ? enqueueError.message : "unknown enqueue error";
      const service = getServiceClient();
      await service.rpc("refund_credits", {
        p_user: userId,
        p_script: script.id,
        p_amount: generationCost,
      });
      await supabase
        .from("scripts")
        .update({ status: "failed", error_message: `enqueue_failed: ${message}`.slice(0, 4000) })
        .eq("id", script.id);

      return NextResponse.json({ error: `enqueue_failed: ${message}` }, { status: 502 });
    }

    return NextResponse.json({ script_id: script.id }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
