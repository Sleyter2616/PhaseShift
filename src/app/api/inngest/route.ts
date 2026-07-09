import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateScript } from "@/inngest/functions/generate-script";
import { synthesizeSegment } from "@/inngest/functions/synthesize-segment";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateScript, synthesizeSegment],
});
