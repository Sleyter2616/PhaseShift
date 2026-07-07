import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "phaseshift" });

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
  };
};

export type Phase1Events = ScriptGenerateRequested | ScriptSynthesizeSegment;
