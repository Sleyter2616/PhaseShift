import { inngest } from "../client";
import { getServiceClient } from "@/lib/db/service-client";
import {
  runSynthesizeSegment,
  type SynthesizeSegmentInput,
} from "@/lib/pipeline/synthesize-segment-job";

export const synthesizeSegment = inngest.createFunction(
  {
    id: "synthesize-segment",
    concurrency: { limit: 3 },
    triggers: [{ event: "script/synthesize-segment" }],
  },
  async ({ event }) => {
    const supabase = getServiceClient();
    return runSynthesizeSegment(supabase, event.data as SynthesizeSegmentInput);
  },
);
