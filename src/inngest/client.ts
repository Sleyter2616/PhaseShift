import { Inngest } from "inngest";

/**
 * Cloud mode (default): uses INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY from env.
 * Dev mode only when INNGEST_DEV=1 (local Inngest Dev Server; no signing keys).
 */
const isDev = process.env.INNGEST_DEV === "1";

export const inngest = new Inngest({
  id: "phaseshift",
  isDev,
  ...(isDev
    ? {}
    : {
        eventKey: process.env.INNGEST_EVENT_KEY,
        signingKey: process.env.INNGEST_SIGNING_KEY,
      }),
});

export type ScriptGenerateRequested = {
  name: "script/generate.requested";
  data: { script_id: string };
};

export type ScriptSynthesizeSegment = {
  name: "script/synthesize-segment";
  data: {
    script_id: string;
    segment_id: string;
    user_id: string;
    dedupe_key: string;
    text: string;
    pacing_wpm: number;
    previous_text?: string;
    next_text?: string;
  };
};

export type Phase1Events = ScriptGenerateRequested | ScriptSynthesizeSegment;
