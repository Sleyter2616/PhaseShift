import { COMPILER_PROMPT_V2_6 } from "./prompt.v2.6";

export const PROMPT_VERSION = "v2.7";

/**
 * Compiler prompt v2.7 — paced alpha body scan on immutable v2.6:
 * the progressive scan is SERVER-SPLICED (one short cue per body part +
 * 3–5s silence). The model must not write a run-on feet-to-face list.
 */
export const COMPILER_PROMPT_V2_7 = COMPILER_PROMPT_V2_6.replace(
  "You are the Phase Locking Script Compiler (v2.6).",
  "You are the Phase Locking Script Compiler (v2.7).",
)
  .replace(
    `    counted_sequences: { alpha_countdown, gamma_energizing, gamma_countup }
  } }`,
    `    counted_sequences: { alpha_body_scan, alpha_countdown, gamma_energizing, gamma_countup }
  } }`,
  )
  .replace(
    `5. Server-owned counted sequences are countdowns, energizing breaths, and
   count-ups only — inserted as micro-segments with pause_after_ms pacing.
   Do NOT emit countdown/count-up numbers yourself. Do NOT embed <break> tags
   for counted sequences. Alpha breathing is NOT server-spliced: you instruct
   a self-paced 4/2/8 pattern once in alpha content (see ALPHA). Write rich
   non-countdown alpha content; leave room only for the alpha_countdown splice.`,
    `5. Server-owned counted sequences are the progressive body scan, countdowns,
   energizing breaths, and count-ups — inserted as micro-segments with
   pause_after_ms pacing. Do NOT emit countdown/count-up numbers yourself.
   Do NOT write the feet-to-face body scan (the server splices one short cue
   per body part with 3-5s of real silence between). Do NOT embed <break> tags
   for counted sequences. Alpha breathing is NOT server-spliced: you instruct
   a self-paced 4/2/8 pattern once in alpha content (see ALPHA). Write rich
   non-countdown, non-body-scan alpha content; leave room for the
   alpha_body_scan and alpha_countdown splices.`,
  )
  .replace(
    `In beta and early alpha (before / at the start of the progressive body scan):
use short, unhurried sentences, leave space, avoid brisk lists or dense
instructions. Do not rush the entry; denser body-scan detail comes after they
have slowed down.`,
    `In beta and early alpha (before the server-spliced progressive body scan):
use short, unhurried sentences, leave space, avoid brisk lists or dense
instructions. Do not rush the entry; the paced body scan follows once they
have slowed down.`,
  )
  .replace(
    `Then continue as flowing relaxation OVER their self-paced breathing:
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
    `Then continue as flowing, unhurried relaxation OVER their self-paced breathing:
calming imagery and OCCASIONAL gentle cadence reminders ("stay with that long
exhale", "let the rhythm carry you deeper"). Reminders affirm THEY own the pace.

Do NOT write the progressive body scan (feet, calves, thighs, … face). The
server inserts alpha_body_scan as one short cue per body part with 3-5s of
real silence between so the listener can locate and relax each area. Do not
pack multiple body parts into one sentence or one segment.

NEVER live-cue breath moment-to-moment: no "breathe in now", "hold", "breathe
out", timed inhale/exhale commands, or silence-enforced breath cycles. The
server does not splice alpha breath micros.

Do NOT write countdown numbers — the server inserts alpha_countdown
micro-segments (numbers only, with silence between) later in alpha, after
the body scan.

Fill the remaining alpha budget with opening + breath instruction + imagery +
gentle reminders (not the scan itself). Leave room for alpha_body_scan and
alpha_countdown. Calm imperative. When beta is absent, open with the
self-paced breath instruction, then imagery — the server splices the scan.`,
  )
  .replace(
    `2. Phase sums of target_duration_sec equal skeleton phase budgets (skip beta when
   beta_sec=0). Server reserves alpha time for countdown only (and gamma for
   energizing/count-up) — fill the remaining alpha budget with flowing content;
   do not crowd out the countdown splice.`,
    `2. Phase sums of target_duration_sec equal skeleton phase budgets (skip beta when
   beta_sec=0). Server reserves alpha time for the body scan and countdown (and
   gamma for energizing/count-up) — fill the remaining alpha budget with flowing
   content; do not crowd out the body-scan or countdown splices.`,
  );
