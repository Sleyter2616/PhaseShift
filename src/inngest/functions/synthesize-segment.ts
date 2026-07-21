import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import {
  runSynthesizeSegment,
  type SynthesizeSegmentInput,
} from "@/lib/pipeline/synthesize-segment-job";
import { capturePathError } from "@/lib/sentry/capture";
import { TTSProviderError } from "@/lib/tts/errors";

export const synthesizeSegment = inngest.createFunction(
  {
    id: "synthesize-segment",
    concurrency: { limit: 3 },
    triggers: [{ event: "script/synthesize-segment" }],
  },
  async ({ event }) => {
    const supabase = getServiceClient();
    try {
      return await runSynthesizeSegment(supabase, event.data as SynthesizeSegmentInput);
    } catch (error) {
      capturePathError(error, "pipeline.synthesize_segment");
      if (error instanceof TTSProviderError && !error.retriable) {
        throw new NonRetriableError(error.message);
      }
      throw error;
    }
  },
);
