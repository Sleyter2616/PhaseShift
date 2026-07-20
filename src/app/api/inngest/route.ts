import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateScript } from "@/inngest/functions/generate-script";
import { synthesizeSegment } from "@/inngest/functions/synthesize-segment";

/** Always run on the Node serverless runtime (never static). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Allow long checkpointed steps on Vercel (Pro: up to 300s). */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateScript, synthesizeSegment],
});
