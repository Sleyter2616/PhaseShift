import { COMPILER_PROMPT_V2_2 } from "./prompt.v2.2";

export const PROMPT_VERSION = "v2.3";

/**
 * Compiler prompt v2.3 — self-paced breath instruction on immutable v2.2:
 * - Alpha no longer uses server-spliced live breath cues
 * - Model instructs 4/2/8 once, then flowing content + gentle reminders
 * - Countdown stays server-led (numbers only)
 */
export const COMPILER_PROMPT_V2_3 = COMPILER_PROMPT_V2_2.replace(
  "You are the Phase Locking Script Compiler (v2.2).",
  "You are the Phase Locking Script Compiler (v2.3).",
)
  .replace(
    `    counted_sequences: { alpha_breath, alpha_countdown, gamma_energizing, gamma_countup }
  } }`,
    `    counted_sequences: { alpha_countdown, gamma_energizing, gamma_countup }
  } }`,
  )
  .replace(
    `5. Counted sequences (breaths, countdowns, energizing breaths, count-ups) are
   SERVER-INSERTED as micro-segments with pause_after_ms pacing. Do NOT emit
   breath/countdown/count-up cycles yourself. Do NOT narrate timing ratios
   ("four in, two hold"). Do NOT embed <break> tags for counted sequences.
   Write only non-counted content for alpha/gamma; the server splices the
   timed cue micro-segments in.`,
    `5. Server-owned counted sequences are countdowns, energizing breaths, and
   count-ups only — inserted as micro-segments with pause_after_ms pacing.
   Do NOT emit countdown/count-up numbers yourself. Do NOT embed <break> tags
   for counted sequences. Alpha breathing is NOT server-spliced: you instruct
   a self-paced 4/2/8 pattern once in alpha content (see ALPHA). Write rich
   non-countdown alpha content; leave room only for the alpha_countdown splice.`,
  )
  .replace(
    `## ALPHA (induction)
Your alpha segments are progressive muscle tension-release (feet to face) and
calm body cues ONLY. Calm imperative. Purpose: releasing tension frees nervous
system resources for the work ahead.

HARD BAN — write ZERO references to breathing, breath, inhale, exhale, rhythm,
cadence, or "breathe with" anything. Do NOT preview or narrate a breath cadence
("a rhythm you're about to hear", "breathe with the cues", etc.). The server's
breath micro-segments ("Breathe in." / "Hold." / "Breathe out." plus silence)
are the ENTIRE breath experience — model text must not collide with them.
Do NOT write countdown numbers or timing ratios; the server inserts those too.
When beta is absent, begin alpha directly with tension-release — do not invent
an orienting/breath lead-in.`,
    `## ALPHA (induction)
Near the start of alpha, instruct the self-paced breath pattern ONCE. State the
4 / soft-hold 2 / long-exhale 8 ratio as guidance the listener follows at their
own pace. Write it naturally (not as a robot script); intent:
"Breathe at your own pace — in for about four, a soft hold for two, and a long
exhale for eight. Let the exhale be longer than the inhale."

Then continue as flowing relaxation OVER their self-paced breathing:
progressive muscle tension-release (feet to face), calming imagery, and
OCCASIONAL gentle cadence reminders ("stay with that long exhale", "let the
rhythm carry you deeper"). Reminders affirm THEY own the pace.

NEVER live-cue breath moment-to-moment: no "breathe in now", "hold", "breathe
out", timed inhale/exhale commands, or silence-enforced breath cycles. The
server does not splice alpha breath micros.

Do NOT write countdown numbers — the server inserts alpha_countdown
micro-segments (numbers only, with silence between) later in alpha.

Fill the alpha phase budget with continuous spoken content (instruction + body
release + imagery + gentle reminders). Aim for 85-95% of the alpha word budget —
richer continuous alpha helps session length. Calm imperative. When beta is
absent, open with the self-paced breath instruction then tension-release.`,
  )
  .replace(
    `5. No counted-sequence narration, no breath/rhythm/cadence language anywhere
   in model text, no timing ratios spoken aloud, no worded numbers inside
   <break> tags. Any inline <break> uses numeric seconds ≤ 3.0s.`,
    `5. No live breath cueing (no "breathe in now" / Hold / "breathe out" commands).
   Alpha MAY include one self-paced 4/2/8 instruction plus occasional gentle
   reminders. No countdown/count-up narration (server owns those). No worded
   numbers inside <break> tags. Any inline <break> uses numeric seconds ≤ 3.0s.`,
  )
  .replace(
    `2. Phase sums of target_duration_sec equal skeleton phase budgets (skip beta when
   beta_sec=0). Server will reserve alpha/gamma time for counted micro-segments —
   leave room; do not fill alpha/gamma entirely with text that crowds them out.`,
    `2. Phase sums of target_duration_sec equal skeleton phase budgets (skip beta when
   beta_sec=0). Server reserves alpha time for countdown only (and gamma for
   energizing/count-up) — fill the remaining alpha budget with flowing content;
   do not crowd out the countdown splice.`,
  );
