import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import {
  markSegmentSynthesisFailed,
  runSynthesizeSegment,
  type SynthesizeSegmentInput,
} from "@/lib/pipeline/synthesize-segment-job";
import { capturePathError } from "@/lib/sentry/capture";
import { TTSProviderError } from "@/lib/tts/errors";

export const synthesizeSegment = inngest.createFunction(
  {
    id: "synthesize-segment",
    concurrency: { limit: 3 },
    retries: 2,
    triggers: [{ event: "script/synthesize-segment" }],
  },
  async ({ event }) => {
    const supabase = getServiceClient();
    const input = event.data as SynthesizeSegmentInput;
    try {
      return await runSynthesizeSegment(supabase, input);
    } catch (error) {
      capturePathError(error, "pipeline.synthesize_segment");
      if (input.script_id && input.segment_id) {
        await markSegmentSynthesisFailed(supabase, input.script_id, input.segment_id);
      }
      if (error instanceof TTSProviderError && !error.retriable) {
        throw new NonRetriableError(error.message);
      }
      throw error;
    }
  },
);
