# Execution Blueprint: Reality-Engineering Meditation App

Companion to Master Prompt v2. Every section below is buildable as written. Stack: Next.js (TS) PWA + Supabase + Claude + ElevenLabs + Web Audio API.

---

## 0. Executive Decisions


| #   | Decision                | Call                                                                                                                     | Why                                                                                                                                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mix location            | Client-side layering via Web Audio; v1 offline render uses `OfflineAudioContext -> PCM -> Worker encoder -> cached Blob` | Entrainment tones cost nothing to synthesize locally; preserves the binaural/isochronic toggle per playback context; avoids server-side pre-mixes; avoids the false `OfflineAudioContext -> MediaRecorder` path |
| 2   | Synthesis granularity   | Per-segment TTS with content-hash dedupe                                                                                 | Enables Iterative Triangulation regens at ~40% of full cost; ElevenLabs request limits force chunking anyway; per-segment timing data feeds the scheduler                                                       |
| 3   | LLM + TTS orchestration | Inngest (or Trigger.dev) jobs between Next.js and the APIs                                                               | Retries, fan-out, rate-limit handling, no long-running request cycles; Supabase alone has no real queue                                                                                                         |
| 4   | Hosting                 | Vercel + Supabase + Inngest                                                                                              | With client-side layering there is no server-side audio processing, so AWS buys nothing at this stage                                                                                                           |
| 5   | Pricing                 | Hybrid: subscription base + metered **minutes** (two-pool)                                                               | Playback is near-zero marginal cost and must feel unlimited (daily habit); generation costs real dollars per session and is metered by `length_min × voice_multiplier`                                                                          |


---

## 1. Application Scaffolding & Architecture

### 1.1 End-to-end data flow

```
Intake Wizard (7 screens)
      |
      | intake JSON (Zod-validated client + server)
      v
POST /api/scripts
      |  validates intake (length + contiguous middle steps + posture)
      |  builds server skeleton (phase budgets, theta step timings, counted sequences)
      |  spends minutes (subscription-first), writes goal_version + script(status=generating)
      |  returns script_id immediately
      v
Inngest job: generate-script  (route maxDuration=300s; soft compile budget ~270s)
      |
      |-- step: compile-attempt-1 — Claude compile (prompt **v2.7** default + intake +
      |          skeleton givens; pin older via COMPILER_PROMPT_VERSION; v1.4 fallback)
      |          Soft-budget timeout → schedule **compile-attempt-1-retry** as its **own**
      |          Inngest step (fresh 300s ceiling). Fail only if the retry also times out.
      |-- step: Zod-validate manifest against skeleton steps/budgets; 1 retry with errors
      |-- step: script-qa (person-agreement fix; block broken scripts pre-synth)
      |-- step: compile-length-check — if under 97% of budget, schedule **compile-attempt-2**
      |          as its **own** Inngest step (fail-open; never a sync re-call in attempt-1)
      |-- step: insert script_segments; hash-diff against audio_files (dedupe_key)
      |-- step: fan out synthesize-segment jobs for CHANGED segments only
      |             (concurrency 3-5, exponential backoff on 429)
      |                    |
      |                    v
      |             ElevenLabs TTS per segment
      |             - parallel-safe prosody: previous_text / next_text
      |             - do NOT depend on previous_request_ids in fan-out mode
      |                    |
      |                    v
      |             Supabase Storage
      |             - cloned/user voice path: {user_id}/{audio_file_id}.mp3
      |             - shared stock path: shared/{stock_voice_id}/{audio_file_id}.mp3
      |
      |-- step: write actual_duration_sec per segment
      |-- step: reconcile wall-clock length (theta dwelling silence → exact budget)
      |-- step: mark script ready
      v
Inngest cron (every 5 min): stuck-generation-reaper
      |  scripts stuck status=generating >10 min with 0 ready segments
      |  → mark failed + idempotent minutes refund
      v
Supabase Realtime -> client (progressive: playback can start once beta+alpha are ready;
                              theta finishes synthesizing during the induction)
      |
      v
PWA client: manifest + signed URLs -> service worker caches segment bodies; refreshes URLs before expiry
      |
      v
Web Audio engine: voice buffers scheduled over oscillator bed (Section 1.3)
      |
      v
Session log (sessions, exit_alertness) -> Recognition Log (feature_signals)
      |
      v
Approximation trigger (3+ matched features) -> new goal_version -> back to top
                                               (hash-diff regen, ~40% of chars)
```

The Iterative Triangulation loop is the outer cycle of this diagram, not a separate feature. The whole system is a loop, not a pipeline.

### 1.2 The three build decisions, justified

**A. Client-side layering, with a v1 offline-render upgrade.**
Pre-mixing server-side is the wrong call for this app:

- The tone bed is pure oscillators. Generating it in the browser is free. Pre-mixing means storing and egressing a full-length stereo file per script version.
- Binaural beats require stereo separation and headphones; isochronic tones work on speakers. Pre-mixing bakes that choice in at generation time. Client-side layering makes it a playback-time toggle.
- Frequency glides, voice/tone balance, and per-phase volume become user settings instead of regeneration events.

The one real cost is iOS: Web Audio graphs stop when a PWA is backgrounded or the screen locks. Mitigation in two stages:

- MVP: foreground playback with the Screen Wake Lock API and a dimmed session UI. Meditation posture is phone-down, screen-on. Acceptable for v0.
- v1: after generation, render the full session once on-device with `OfflineAudioContext`, then encode the rendered PCM directly in a Web Worker. Preferred path: Float32 PCM -> interleaved PCM -> `lamejs` MP3 at 128 kbps for maximum playback compatibility, or a WASM Opus/Ogg encoder where browser support is acceptable. Cache the resulting Blob in Cache Storage or IndexedDB, then play it through an HTML audio element with MediaSession metadata. Do not use `MediaRecorder` as the offline encoder: `OfflineAudioContext` resolves to an `AudioBuffer`, while `MediaRecorder` records a `MediaStream`, so that path requires replaying the full session in real time through a live context. `WebCodecs.AudioEncoder` can be a feature-detected optimization later, not a v1 dependency.

**B. Per-segment synthesis with a content-hash cache.**

```
dedupe_key = sha256(elevenlabs_voice_id | model_id | voice_settings_json | segment_text)
```

- Alpha induction and Gamma exit are largely goal-agnostic templates. For stock voices, store these as shared assets with `user_id = null`, so every user can reuse the same generated template segment instead of duplicating it under separate private folders.
- A re-triangulation typically rewrites steps 3-6 and 9-10, which is roughly 35-45% of total characters. Everything else is served from cache.
- Prosody continuity across segment boundaries: in the default parallel fan-out path, pass `previous_text` and `next_text` for each segment. Do not use `previous_request_ids` unless synthesizing sequentially, because request IDs only exist after prior requests finish.
- Optional high-fidelity path: chain sequentially inside each phase using `previous_request_ids`, while parallelizing across phases. This preserves natural continuity and still gives four-way concurrency.
- Note: inline break tags are billable characters. Budget for them (Section 5).

**C. Job orchestration outside the request cycle.**
A full-length session (up to 45 minutes) is substantial TTS API work plus a Claude compile. None of that belongs in a route handler regardless of platform timeouts. Inngest gives you per-step retries, fan-out with a concurrency cap matched to your ElevenLabs plan, dead-letter visibility, and status writes the client consumes over Realtime. Trigger.dev is an equivalent choice; pgmq on Supabase works if you want zero extra vendors, at the cost of building retry semantics yourself.

### 1.3 Audio engine

**Node graphs.**

Binaural (headphones):

```
Osc A (carrier, e.g. 200 Hz) -> StereoPanner(-1) --+
Osc B (carrier + beat Hz)    -> StereoPanner(+1) --+--> toneGain (~ -18 dB) --+
                                                                              +--> master -> destination
Voice AudioBufferSource (scheduled per manifest) --> voiceGain ---------------+
```

Isochronic (speakers OK): one carrier oscillator, amplitude-modulated by a square LFO at the beat frequency (ConstantSource 0.5 offset + LFO through a 0.5-depth gain into the AM gain param).

Glides: ramp the beat parameter, not the carrier. For binaural, ramp Osc B frequency to carrier + targetBeat; for isochronic, ramp the LFO frequency. linearRampToValueAtTime over 30-60 s at phase boundaries.

**Core engine sketch (TypeScript):**

```ts
export class EntrainmentEngine {
  private ctx = new AudioContext();
  private master = this.ctx.createGain();
  private toneGain = this.ctx.createGain();
  private voiceGain = this.ctx.createGain();
  private oscB?: OscillatorNode;   // binaural beat carrier (right)
  private lfo?: OscillatorNode;    // isochronic beat LFO

  constructor(private mode: 'binaural' | 'isochronic',
              private carrierHz = 200) {
    this.toneGain.gain.value = 0.08;   // subtle bed; capped at TONE_GAIN_MAX (0.15)
    this.voiceGain.gain.value = 1.0;
    this.toneGain.connect(this.master);
    this.voiceGain.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  startBed(beatHz: number) {
    if (this.mode === 'binaural') {
      const a = new OscillatorNode(this.ctx, { frequency: this.carrierHz });
      this.oscB = new OscillatorNode(this.ctx, { frequency: this.carrierHz + beatHz });
      a.connect(new StereoPannerNode(this.ctx, { pan: -1 })).connect(this.toneGain);
      this.oscB.connect(new StereoPannerNode(this.ctx, { pan: 1 })).connect(this.toneGain);
      a.start(); this.oscB.start();
    } else {
      const carrier = new OscillatorNode(this.ctx, { frequency: this.carrierHz });
      const am = this.ctx.createGain(); am.gain.value = 0;
      const offset = new ConstantSourceNode(this.ctx, { offset: 0.5 });
      this.lfo = new OscillatorNode(this.ctx, { frequency: beatHz, type: 'square' });
      const depth = this.ctx.createGain(); depth.gain.value = 0.5;
      offset.connect(am.gain);
      this.lfo.connect(depth).connect(am.gain);
      carrier.connect(am).connect(this.toneGain);
      offset.start(); this.lfo.start(); carrier.start();
    }
  }

  glideBeat(toHz: number, seconds: number) {
    const t = this.ctx.currentTime + seconds;
    if (this.mode === 'binaural')
      this.oscB!.frequency.linearRampToValueAtTime(this.carrierHz + toHz, t);
    else
      this.lfo!.frequency.linearRampToValueAtTime(toHz, t);
  }

  scheduleVoice(buf: AudioBuffer, atSec: number) {
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf });
    src.connect(this.voiceGain);
    src.start(this.ctx.currentTime + atSec);
  }
}
```

**Scheduling.** Compute each segment's start offset from the running sum of actual_duration_sec + pause_after_ms (actuals come back from synthesis, so timing is exact, not estimated). Use a lookahead scheduler (setInterval ~200 ms, schedule 2-3 s ahead on the AudioContext clock) rather than starting an entire session's sources at once.

**Defaults.** Carrier 180-220 Hz; entrainment tone is a **subtle bed under voice** — `TONE_GAIN_DEFAULT = 0.08`, hard-capped at `TONE_GAIN_MAX = 0.15` (`src/lib/audio/mix.ts`) so the full slider stays usable without drowning speech. Isochronic is the default mode with a headphones toggle for binaural (device headphone detection is unreliable, so ask, do not sniff). AudioContext must be resumed on a user gesture (iOS requirement): the Begin Session button does it.

**Offline render encoder path for v1.**

```ts
// High-level only: implementation belongs in a Worker.
async function renderOffline(manifest: SessionManifest) {
  const offline = new OfflineAudioContext({
    numberOfChannels: 2,
    length: manifest.totalDurationSec * 44100,
    sampleRate: 44100,
  });

  // Rebuild the same oscillator bed and scheduled voice buffers into `offline`.
  // Then render to PCM faster than real time.
  const rendered: AudioBuffer = await offline.startRendering();

  // Transfer channel Float32Arrays to a Worker.
  // Worker encodes PCM directly, e.g. MP3 via lamejs at 128 kbps.
  // MediaRecorder is not used here because it consumes MediaStream, not AudioBuffer.
  return encodePcmInWorker(rendered);
}
```

Expected output size: 128 kbps MP3 is ~43 MB for 45 minutes (~38 MB for 40). Cache by `script_id + render_settings_hash`, because binaural/isochronic mode, carrier, tone gain, and voice gain change the rendered result.

### 1.4 Supabase schema (DDL)

```sql
create type phase as enum ('beta','alpha','theta','gamma','delta');
create type pl_perspective as enum ('first','second','third');
create type horizon as enum ('introspective','retrospective','protospective');
create type archetype as enum ('child','trickster','warrior','thief','magician','creator');
create type audio_asset_scope as enum ('user','shared');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  tier text not null default 'trial' check (tier in ('trial','guided','practitioner')),
  -- Generation path uses two-pool minutes (migration 0012). credit_balance remains
  -- for legacy credit_* tables but is RETIRED from script generation.
  subscription_minutes integer not null default 0 check (subscription_minutes >= 0),
  subscription_minutes_reset_at timestamptz,
  topup_minutes integer not null default 0 check (topup_minutes >= 0),
  onboarded_at timestamptz,               -- set when /welcome completes
  primer_seen_at timestamptz,             -- set when first-session how-to is dismissed
  credit_balance numeric not null default 0 check (credit_balance >= 0), -- retired from generation
  created_at timestamptz default now()
);

create table voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  elevenlabs_voice_id text,
  status text not null default 'pending' check (status in ('pending','ready','failed')),
  consent_confirmed_at timestamptz,        -- own-voice consent, required before clone job runs
  created_at timestamptz default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  raw_statement text not null,
  aos_layer text check (aos_layer in ('ego','self','persona','shadow')),
  status text not null default 'active' check (status in ('active','converged','abandoned')),
  created_at timestamptz default now(),
  converged_at timestamptz
);

-- One row per triangulation pass. Immutable: history is the point.
create table goal_versions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  version int not null,
  localization_timeframe text not null,
  localization_place text not null,
  triangulation jsonb not null,            -- exactly 3 strings
  not_list jsonb not null,                 -- 2-5 strings
  wrong_direction_pulls jsonb,             -- 0-3 strings (Warrior targets)
  features jsonb not null,                 -- 3-7 expected waking-life signals
  sync_actions jsonb not null,             -- 1-5 {action, deadline?}
  created_at timestamptz default now(),
  unique (goal_id, version)
);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  goal_version_id uuid not null references goal_versions(id),
  voice_profile_id uuid references voice_profiles(id),
  llm_model text,
  prompt_version text,                     -- pin compiler prompt versions; regen diffs depend on it
  entrainment_mode text not null default 'isochronic'
    check (entrainment_mode in ('binaural','isochronic')),
  person_config jsonb not null default '{"induction":"second","theta_declarations":"first"}',
  status text not null default 'generating'
    check (status in ('generating','synthesizing','ready','failed')),
  total_duration_sec int,
  created_at timestamptz default now()
);

create table audio_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),       -- null only for shared stock-voice assets
  asset_scope audio_asset_scope not null default 'user',
  dedupe_key text not null,                   -- sha256(scope|voice|model|settings|text)
  storage_path text not null,
  duration_sec numeric,
  bytes int,
  format text default 'mp3',
  elevenlabs_request_id text,
  created_at timestamptz default now(),
  check (
    (asset_scope = 'user' and user_id is not null) or
    (asset_scope = 'shared' and user_id is null)
  )
);

-- User-cloned voice assets are scoped per user; stock voice assets are reusable globally.
create unique index audio_files_user_dedupe_idx
  on audio_files(user_id, dedupe_key)
  where asset_scope = 'user';

create unique index audio_files_shared_dedupe_idx
  on audio_files(dedupe_key)
  where asset_scope = 'shared';

create table script_segments (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts(id) on delete cascade,
  seq int not null,
  phase phase not null,
  step int check (step between 1 and 12), -- null outside theta
  title text,
  perspective pl_perspective,
  temporal_horizon horizon,
  archetype archetype,
  text text not null,
  target_duration_sec int not null,
  actual_duration_sec numeric,             -- written back after synthesis
  pacing_wpm int not null,
  pause_after_ms int not null default 0,       -- compiler pause; may be rescaled after synthesis
  scheduled_pause_after_ms int,                -- deterministic phase-budget reconciliation output
  entrainment_hz numeric not null,
  glide_to_hz numeric,
  content_hash text not null,
  audio_file_id uuid references audio_files(id),
  synthesis_status text not null default 'pending'
    check (synthesis_status in ('pending','processing','ready','failed')),
  unique (script_id, seq)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  script_id uuid not null references scripts(id),
  started_at timestamptz default now(),
  completed_at timestamptz,
  progress_sec int default 0,
  exit_alertness int check (exit_alertness between 1 and 5),  -- post-Gamma self-report
  notes text
);

create table feature_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  goal_id uuid not null references goals(id),
  goal_version_id uuid references goal_versions(id),
  signal_text text not null,
  matched_feature text,                    -- which predicted feature this maps to, if any
  logged_at timestamptz default now()
);

create table minutes_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  delta integer not null,                  -- positive = grant/purchase/refund; negative = spend/reset
  pool text not null check (pool in ('subscription', 'topup')),
  reason text not null check (reason in ('grant', 'purchase', 'spend', 'refund', 'reset')),
  script_id uuid references scripts(id),
  created_at timestamptz not null default now()
);

-- Legacy credit ledger (RETIRED from generation path; kept for historical rows).
create table credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id),
  delta numeric not null,
  reason text not null check (reason in ('purchase','grant','generation','regen','refund')),
  script_id uuid references scripts(id),
  created_at timestamptz default now()
);
```

**RLS strategy.**

```sql
-- Enable RLS on every table above, then:
create policy own_rows on goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Repeat the same owner policy for profiles(id), voice_profiles, scripts,
-- script_segments (via join or denormalized user_id), sessions, and feature_signals.

-- audio_files: users can SELECT their own `asset_scope='user'` rows plus all
-- `asset_scope='shared'` rows. Clients do not INSERT/UPDATE audio_files directly.
-- Inngest workers write user assets to {user_id}/{audio_file_id}.mp3 and shared
-- stock assets to shared/{stock_voice_id}/{audio_file_id}.mp3.

-- goal_versions: SELECT + INSERT only. No UPDATE/DELETE policy => triangulation history is immutable.

-- minutes_ledger: SELECT own rows only. No client write policies. Spends/grants/refunds
-- go through SECURITY DEFINER functions that lock `profiles` FOR UPDATE, mutate
-- subscription_minutes / topup_minutes, and insert ledger rows in the same transaction.
-- Key functions (see supabase/migrations/0012_minutes.sql):
--   minutes_cost(length_minutes, is_own_voice)
--   spend_minutes(p_user, p_minutes, p_script)          -- subscription-first
--   refund_minutes(...)
--   grant_subscription_minutes(...)                     -- service_role; monthly reset
--   grant_topup_minutes(...)                            -- service_role; never expire

-- credit_ledger / spend_credits: RETIRED from the generation path. Do not use for
-- new script billing.

-- Storage: private bucket 'audio'. Owner path policy for user assets:
-- (storage.foldername(name))[1] = auth.uid()::text.
-- Shared stock assets live under shared/... and are written only by service role;
-- read access is mediated through signed URLs, not broad public bucket access.

-- Signed URL TTL must exceed max session length + startup/cache lag. Default to
-- 24 hours. The service worker caches response bodies and refreshes signed URLs
-- before expiry when a cached body is missing or stale.

-- Inngest workers use the service role key (bypasses RLS) and are the only
-- writers of audio_files, synthesis_status, actual_duration_sec, and
-- scheduled_pause_after_ms.
```

**Approximation trigger.** When feature_signals for the active goal_version reaches 3 matched features (or 50% of predicted features), surface the Re-Triangulate CTA. It pre-fills a new goal_version at version + 1, the user edits triangulation/features/actions, and generation runs with the hash-diff so only changed segments are billed and synthesized.

---

## 2. Optimizing the 12 Steps (Prompt Engineering)

### 2.1 Output contract

The compiler returns exactly one JSON object. Validate with Zod server-side; on failure, retry once with the validator errors appended to the conversation. **Field names are stable** (`phases` via segment `phase`, `segments`, `step`, `target_duration_sec`, `phase_budget_sec`). What changed in v0.5-1 is **who computes** budgets and which theta steps exist — the server skeleton — not the JSON schema the model fills.

```json
{
  "meta": {
    "goal_version_id": "uuid",
    "total_duration_sec": 2700,
    "phase_budget_sec": { "beta": 120, "alpha": 360, "theta": 1980, "gamma": 240 },
    "entrainment_plan": [
      { "phase": "beta",  "hz": 18, "glide_to": 10, "glide_sec": 45 },
      { "phase": "alpha", "hz": 10, "glide_to": 6,  "glide_sec": 60 },
      { "phase": "theta", "hz": 6,  "glide_to": null },
      { "phase": "gamma", "hz": 40, "glide_sec": 30 }
    ]
  },
  "segments": [
    {
      "seq": 1, "phase": "beta", "step": null, "title": "Orientation",
      "perspective": "second", "temporal_horizon": "introspective", "archetype": null,
      "pacing_wpm": 130, "target_duration_sec": 120, "pause_after_ms": 4000,
      "text": "You are seated. The protocol begins now. <break time=\"2.0s\"/> Tonight you run one objective: ..."
    }
  ]
}
```

When `beta` budget is `0` (10-minute sessions), omit beta segments entirely and omit beta from `entrainment_plan`.

### 2.2 Compiler prompts (versioned, immutable)

Prompts live in `src/lib/compiler/prompt.vN.ts`. **Once shipped, a version is immutable** — add `prompt.vN+1.ts` instead of editing. Default today: **v2.7** (`resolveCompilerPromptVersion` in `compile.ts`).

| Version | Role |
| ------- | ---- |
| **v2.7** (default) | Server-paced alpha body scan (one cue per body part + 3–5s silence). |
| **v2.6** | Unhurried opening (beta + early alpha before body scan). |
| **v2.5** | Person-aware intake embeds (`my→your` in second-person guidance) + pre-synth script-qa. |
| **v2.4** | Hard word-budget minimums so content aims at labeled duration (underwrite gate at 97%). |
| **v2.3** | Self-paced breath: state 4/2/8/2 **once**, then guide over the user's own pacing (no live cueing). |
| **v2.2** | Depth-by-length calibration (full arc at 30; denser at 45). |
| **v2.1** | Listen-pass: seamless phase transitions; no phase-name announcements. |
| **v2.0** | Skeleton as GIVENS: phase budgets, selected steps, posture, counted-sequence tables. |
| **v1.4** | Legacy full-arc prompt. Fallback via `COMPILER_PROMPT_VERSION=v1.4`. |

Authoritative text: `src/lib/compiler/prompt.v2.7.ts` (and prior immutable files). Do not paste divergent copies into this blueprint.

**Structural rules (v2.x summary):**

1. Phase order beta → alpha → theta → gamma; **skip beta when `beta_sec = 0`**.
2. Theta contains **only** `skeleton.steps` (bookended 1 + 12), in order; ≥1 segment per listed step.
3. Per-phase sums of `target_duration_sec` equal skeleton / `session.phase_budget_sec` exactly.
4. **Self-paced breathing (v2.3+):** the session tells the 4/2/8/2 pattern once, then continues over the user's own pacing — **not** live inhale/hold/exhale cueing. **Progressive body scan (v2.7+):** server-spliced micro-segments — one short cue per body part (feet→face) with **3–5s of real silence** between so the listener can follow. Alpha countdown = **numbers only into silence** (server-spliced micro-segments). Gamma energizing breaths / count-ups remain server-timed counted sequences.
5. Present tense in theta; banned modal verbs; person-aware verbatim intake; ≥20% break time in alpha/theta; WPM ceilings as soft budgets; hard `target_words` minimums (v2.4+).
6. **Session content QA:** after compile, `script-qa` fixes person-agreement slips and flags broken scripts before synthesis.

### 2.3 Duration, step model, and word budgets

**Length ladder:** `10 | 15 | 30 | 45` minutes. **40 is retired.** Source of truth: `LENGTHS` and budget tables in `src/lib/compiler/skeleton.ts`.

**Phase budgets are SERVER-COMPUTED** via `buildPhaseBudget` / `buildSessionSkeleton`:

- **beta:** elastic to zero — `0` at 10 min (orienting folds into alpha); scales mildly at longer lengths.
- **alpha:** floor ~150s (descent must not be rushed); scales up with length.
- **gamma:** floor ~120s (re-activation viability); scales mildly up to ~240s at 45 min.
- **theta:** elastic remainder = `total − beta − alpha − gamma`. Must stay ≥ `60s × selected_step_count` or the length/step combo is invalid.

Actual per-length table (seconds; sums = `length_min × 60`):

| Length | Beta | Alpha | Theta | Gamma | Total |
| ------ | ---- | ----- | ----- | ----- | ----- |
| 10 min | 0    | 150   | 330   | 120   | 600   |
| 15 min | 60   | 180   | 520   | 140   | 900   |
| 30 min | 90   | 270   | 1260  | 180   | 1800  |
| 45 min | 120  | 360   | 1980  | 240   | 2700  |

**Step model B (locked):**

- The 12 steps keep fixed identity/order (1 Visualize … 12 Closure).
- Steps **1 (Visualize)** and **12 (Closure)** are **mandatory bookends** on every session.
- The user selects a **contiguous** middle block from steps **2..11**.
- Middle-step **count** by length: **10 → 1**, **15 → 2**, **30 → 6**, **45 → 10** (full middle = full 12-step arc).
- Validated by `validateStepSelection(lengthMin, middleStart, middleCount)`.

**Theta time distribution:** `distributeThetaTime` splits `theta_sec` across **selected** steps using relative weights (Visualize heaviest; same weight intent as v1), renormalized so targets sum exactly to `theta_sec`.

**Posture** (`sitting` default | `lying`): does **not** change durations. It **does** change body-reference language in the prompt (sitting vs lying cues for orientation, theta depth, and gamma intensity).

**Counted sequences:** server owns timings via `buildCountedSequence` / splice helpers. Alpha **breath is not spliced** (model writes one self-paced instruction). Alpha **body scan** is server-spliced: 8–12 short cues (feet→face), each followed by 3–5s `pause_after_ms` so the scan is followable — not a run-on list. Alpha **countdown** and gamma energizing/count-up are server-spliced micro-segments (numbers into silence / timed beats). Gamma energizing cycles are always inhale → hold → exhale → pause. The model must not invent competing live breath cues or a packed body-scan list. Body-scan pauses are intentional (not dwelling padding); session length still lands via theta dwelling reconcile.

**Exact session length.** Phase budgets sum to `length_min × 60` exactly. After synthesis, wall-clock length is forced to the budgeted total by **distributed theta dwelling silence** (`reconcileSessionLength` in `src/lib/schedule/reconcile.ts`) — delivered length equals labeled length within tolerance. Billing always charges the **exact budgeted** `length_min × voice_multiplier`, not measured speech time.

**Compile step budgets.** `/api/inngest` sets `maxDuration = 300`. Each compile runs in its own Inngest step with a soft budget of **`COMPILE_STEP_BUDGET_MS` ≈ 270s** (~30s headroom before the hard kill). Compiles log `duration_ms` / `length_min` / `outcome` so long-session latency (especially 45-min) is observable; accept that long sessions may need the timeout retry rather than failing early.

**Soft-timeout retry.** If **compile-attempt-1** hits the soft budget, the pipeline schedules **compile-attempt-1-retry** as a **separate Inngest step** (fresh 300s ceiling) — same pattern as underwrite expand. Minutes were already spent once at enqueue; a successful retry completes the generation without re-spend. Only after the retry also times out (or a hard `CompilerError`) does the script mark `failed` and **refund** (idempotent via `minutes_ledger` refund rows — no double-refund if mark-failed runs more than once).

**Fail-open compile (underwrite).** Compile never hangs on underwrite: attempt-1 fail-opens; if content is under 97% of budget, **compile-attempt-2** runs as a **separate Inngest step** with its own time budget. If attempt-2 fails/times out, the pipeline keeps attempt-1 and dwelling fine-tunes length.

Effective pacing (words per minute, silence included): beta **100**, alpha **78**, theta 105, gamma 150 (opening deliberately slower so beta / early alpha feel unhurried). Character/COGS estimates scale with length; minutes billing meters `length_min × voice_multiplier` (Section 5).

**Gamma energizing breath.** Server-owned `energizing_breath` cycles are complete and possible: inhale → short hold → exhale → pause (never consecutive inhales). Cadence is brisk vs alpha self-paced 4/2/8, but always completable; skeleton validation rejects inhale-without-exhale and over-long holds.

**Post-synthesis duration reconciliation.** Do not trust the compiler to hit duration through word count alone. The source of truth is `actual_duration_sec` plus scheduled pauses. After synthesis:

```ts
for (const phase of phases) {
  const segments = byPhase[phase];
  const budgetSec = phaseBudgetSec[phase];
  if (budgetSec === 0) continue; // beta-absent sessions
  const voicedSec = sum(segments.map(s => s.actual_duration_sec));
  const rawPauseMs = sum(segments.map(s => s.pause_after_ms));
  const remainingMs = Math.max(0, budgetSec * 1000 - voicedSec * 1000);

  if (rawPauseMs > 0) {
    const scale = remainingMs / rawPauseMs;
    for (const s of segments) {
      s.scheduled_pause_after_ms = Math.round(s.pause_after_ms * scale);
    }
  } else {
    // Distribute remainingMs across all segments including the last (D13).
    const perGap = Math.round(remainingMs / Math.max(1, segments.length));
    for (const [i, s] of segments.entries()) {
      s.scheduled_pause_after_ms = i === segments.length - 1
        ? remainingMs - perGap * (segments.length - 1)
        : perGap;
    }
  }

  // If voicedSec alone exceeds budgetSec by more than 2%, mark the phase for
  // targeted text compression/regeneration. Never create negative pauses.
}

// Then: distribute remaining shortfall as theta dwelling pauses (capped per slot)
// so total wall clock ≈ sum(phase_budget_sec) = length_min × 60.
```

The playback scheduler uses `actual_duration_sec + scheduled_pause_after_ms`, not estimated word counts.

### 2.4 Intake wizard (7 screens)


| Screen | Field                                                         | Type                           | Validation                                                                                   | Feeds            |
| ------ | ------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------- |
| 1      | goal_statement                                                | textarea                       | 10-280 chars; present-tense lint (reject leading "I want" / "I will"; offer one-tap rewrite) | Steps 1, 2       |
| 2      | timeframe                                                     | date or preset (30/60/90 days) | required; max 24 months out                                                                  | Step 3           |
| 2      | place                                                         | text                           | required; concrete-noun hint text                                                            | Step 3           |
| 3      | prerequisites                                                 | 3 text inputs                  | exactly 3; 5-140 chars each                                                                  | Step 4           |
| 4      | not_list                                                      | chips                          | 2-5 items                                                                                    | Step 5           |
| 4      | wrong_pulls                                                   | chips                          | 0-3 items                                                                                    | Step 5 (Warrior) |
| 5      | features                                                      | chips                          | 3-7; lint for observability (must contain a concrete noun)                                   | Steps 6-8        |
| 6      | sync_actions                                                  | repeater                       | 1-5 actions, optional deadline each                                                          | Step 9           |
| 7      | length, middle steps, posture, entrainment_mode, voice, senses_emphasis, aos_layer | selects          | length ∈ {10,15,30,45}; contiguous middle_start/middle_count per ladder; posture sitting\|lying; ≥2 senses | meta + skeleton |


Wizard today: **length picker** (10/15/30/45) + posture + entrainment + voice; default length **30** with skeleton-chosen middle steps for that length. Contiguous **middle-step picker UI** is still deferred (API already accepts `middle_start` / `middle_count`). Server validates via skeleton helpers and rejects invalid combos. Reuse-prior-session answers are available when starting a new script from a previous intake. **In-progress drafts** autosave to `localStorage` (per user) so refresh / leaving / Stripe top-up return does not wipe intake. Own-voice appears only when `voice_profiles` has a real ready clone (`status=ready` + non-mock `provider_voice_id`); pending/failed states link back to `/voice`.

Design principle: chips and fixed-count inputs keep every intake item atomic, so the compiler can quote them verbatim. The user's exact words appear in their own voice during the session. This is the Daath principle operationalized: reality quality reflects communication quality, so the app never paraphrases the user.

---

## 3. Visuals & Flow

State progression timeline (45-min full arc; shorter lengths shrink theta and may omit beta):

```
0        2                8                                        41        45 min
|--beta--|-----alpha------|---------------theta--------------------|--gamma--|
 18 Hz -> 10 Hz --------> 6 Hz ---------------------------------> 40 Hz hold
 (glide 45s)   (glide 60s)                              (glide 30s)
```

User journey (first run + the loop):

```
Onboard (/welcome) -> optional welcome topup -> Intake wizard -> generation
   -> First session: primer ("Before you begin") once -> safety -> playback
   -> daily playback (cached, offline); "How to use" in header /how-to for revisit
   -> Recognition Log entries accumulate
   -> 3+ matched features -> Re-Triangulate CTA -> goal_version v2
   -> hash-diff regen (~40% of chars) -> Sessions continue
   -> Convergence -> goal marked converged -> next goal
```

**First-session primer.** Before the first playback, users who have not dismissed it (`profiles.primer_seen_at` null) see a short how-to gate: headphones, quiet place, sit/lie eyes closed (no driving), let it wash over you. CTA: "I'm ready" → marks `primer_seen_at` and continues to the existing safety `prebegin`. Revisit anytime via **How to use** in the setup header (`/how-to`) or a link on the safety screen.

---

## 4. Hosting & Deployment

**Verdict: Vercel + Supabase + Inngest.** The client-side layering decision removed the only workload that would justify AWS (server-side audio mixing).


| Concern            | Where it lives   | Notes                                                                                                                                                                                                                                            |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js app + PWA  | Vercel           | Service worker via serwist; cache manifest + audio segments for offline sessions                                                                                                                                                                 |
| API routes         | Vercel functions | Thin: validate intake, build skeleton, spend minutes, insert rows, enqueue job, return script_id                                                                                                                                                 |
| LLM + TTS work     | Inngest          | Long-running generation; concurrency capped to the ElevenLabs plan; **stuck-generation-reaper** cron every 5 min refunds hard-killed zombies                                                                                                                                 |
| Auth, DB, Realtime | Supabase         | Email/password. **Signup confirm** and **password reset** both use `/auth/callback` (PKCE `exchangeCodeForSession`), distinguished by `next`: confirm → bare `/auth/callback` → `/welcome` or `/scripts` (logged in, no password step); reset → `/auth/callback?next=/reset-password` → `/reset-password` + recovery cookie, then `updateUser({ password })`. Mis-targeted `/?code=` forwards to `/auth/callback` (not reset). Canonical origin `NEXT_PUBLIC_APP_URL` (`https://phaseshift.app` in prod). |
| Audio storage      | Supabase Storage | Private bucket, signed URLs, Smart CDN; user voice assets under `{user_id}/...`, shared stock assets under `shared/...`; TTL defaults to 24h and service worker refreshes signed URLs before expiry; body caching makes repeat plays zero-egress |
| Billing            | Stripe           | Subscriptions + minute top-ups; webhooks call `grant_subscription_minutes` / `grant_topup_minutes` via service role. Optional **welcome grant** (env-toggled) credits topup on first onboarding.                                              |
| Errors             | Sentry           | App Router instrumentation (`@sentry/nextjs`); browser events tunnel via same-origin `/monitoring` (`tunnelRoute`) to bypass ad-blocker CORS; optional locally via `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`                                      |


Fixed infra at small scale: Vercel Pro $20 + Supabase Pro $25 + Inngest $0-20, roughly $50-70/month before TTS. Secrets (Anthropic, ElevenLabs, Stripe, Sentry) live server-side only (or public DSN only where required).

Move to AWS/GCP only when one of these appears: server-side mixing (ffmpeg pipelines), egress measured in terabytes (S3 + CloudFront wins), or bringing TTS in-house. Build a thin TTSProvider interface from day one so ElevenLabs can be swapped for Cartesia or PlayHT without touching the pipeline; pricing and terms in this market move quarterly.

---

## 5. Monetization & Pricing Strategy

### Two-pool minutes model (current)

Generation is metered in **minutes**, not credits. Source of truth: `src/lib/billing/minutes.ts` + `supabase/migrations/0012_minutes.sql`.

| Pool | Column | Behavior |
| ---- | ------ | -------- |
| Subscription | `profiles.subscription_minutes` | Monthly allotment; **reset** each billing cycle via `grant_subscription_minutes` (does not accumulate unused). |
| Top-up | `profiles.topup_minutes` | Purchased packs; **never expire**. |

**Spend order:** subscription first, then topup (`spend_minutes`). Every mutation writes `minutes_ledger` rows under a `FOR UPDATE` lock on `profiles`.

**Session cost:**

```
cost = length_min × voice_multiplier
voice_multiplier: stock = 1×, own_voice = 2×
```

Examples: 10-min stock = **10**; 45-min own voice = **90**.

**SQL surface:** `minutes_cost`, `spend_minutes`, `refund_minutes`, `grant_subscription_minutes`, `grant_topup_minutes`, table `minutes_ledger`.

**Stuck-generation reaper.** Hard kills (Vercel timeout / crash) can leave scripts at `status=generating` forever and leak spent minutes (the failure-refund path only runs on caught errors). An Inngest cron every **5 minutes** finds scripts stuck generating **>10 minutes** with **0 ready segments**, marks them `failed` with a clear reason, and **refunds** spent minutes idempotently (skips if a `refund` ledger row already exists for that script).

**Welcome grant (friends / demo).** When `WELCOME_GRANT_ENABLED=1`, a new user completing `/welcome` (`completeOnboarding`, `onboarded_at` null→set) receives a one-time `grant_topup_minutes` of `WELCOME_GRANT_MINUTES` (default **400**) into the **topup** pool. Idempotent: onboarded_at transition + ledger check. Flip the env var + redeploy to disable — no code change.

**Credits (retired from generation):** `credit_balance`, `credit_ledger`, and `spend_credits` still exist for legacy rows/tests but are **not** used by `POST /api/scripts`.

### Pricing structure


| Tier         | Price             | Includes                                                                                                                                 |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Trial        | Free              | Onboarding; optional one-time **welcome topup** when `WELCOME_GRANT_ENABLED=1`; generation otherwise requires minutes |
| Guided       | **$29/mo**        | **240 minutes/mo** subscription pool; unlimited playback; Recognition Log                                                                |
| Practitioner | **$49/mo**        | **640 minutes/mo**; Freeform / advanced surfaces as they ship                                                                            |
| Top-up       | **$8 = 80 min**   | Adds to `topup_minutes`; never expires                                                                                                   |


Meter creation, not consumption. Playback must feel unlimited because daily practice is the product; generation burns minutes proportional to session length and voice path.

**Voice-quality note:** Instant Voice Cloning remains the MVP own-voice path. Flash vs Multilingual v2 fidelity gating still informs which TTS model clones use; that choice no longer drives a separate credit multiplier — own voice is always **2× minutes**.

Capacity planning still tracks ElevenLabs character spend separately from user-facing minutes. Enable usage-based billing as a vendor buffer with an 80% usage alert; do not expose character credits in the product UI.

---

## 6. MVP Cutline & Roadmap

**v0 / Phases 0–10 (COMPLETE):** Guided core through production deploy — fixed-length generation, TTS pipeline, playback, Stripe, landing, minutes migration, Sentry.

**v0.5 — Customizable Protocol (current):**

- **v0.5-1 (landed through ~1.16 body scan):** Server-owned skeleton; length ladder 10/15/30/45; step model B; posture; self-paced breath; **paced alpha body scan** (one cue per part + 3–5s silence); gamma energizing = full inhale/hold/exhale cycles; opening pace slower (beta 100 / alpha 78 + settle pauses); exact length via theta dwelling; fail-open compile-attempt-2 as its own Inngest step; soft-timeout → one separate-step compile retry (~270s soft / 300s maxDuration); person-agreement script-qa; tone mix cap; prompt **v2.7**; minutes = budgeted length × voice multiplier; welcome grant (env toggle); stuck-generation reaper cron.
- **Wizard length + reuse (landed):** length picker + prior-session answer reuse. Contiguous middle-step picker UI still deferred (API ready).
- **First-session primer (landed):** one-time how-to gate before first playback (`primer_seen_at`); revisit via `/how-to`.
- Later v0.5: Recognition Log / re-triangulate polish; regen copy-through mode (D8).

**v1:** Offline render + true background playback; Freeform sequencing; Practitioner surfaces beyond allotment.

**v1:** Offline render + true background playback; Freeform sequencing; Practitioner surfaces beyond allotment.

**v1.5+: Delta research mode.**
Design that respects the hard-logical-ground standard: the literature does not support learning novel verbal content in deep sleep, but Targeted Memory Reactivation (re-cueing material learned while awake) has real evidence. So Delta mode is replay, not programming: during Theta sessions, each first-person declaration is preceded by a short signature audio motif unique to the goal. Delta mode runs as a sleep-timer session that plays only those motifs (optionally the declarations at whisper level, capped around -30 dB) on a spaced schedule during the first ~3 hours of sleep, when slow-wave sleep dominates. Experiment design: within-subject A/B, alternating cued and silent nights over two weeks, measuring recognition-log entries per day and a morning free-recall check of the declarations. Architecture already accommodates it: delta segments carry an anchor_ref instead of text, the engine plays arbitrary buffers, and the only additions are a sleep timer and a volume cap.

---

## 7. Risk Register

- **iOS background audio.** Solved structurally in v1 by the offline render; v0 is screen-on by design and says so in onboarding.
- **TTS vendor drift.** Prices, terms, and models move quarterly. The dedupe cache, Flash-default policy, and TTSProvider abstraction cap the blast radius.
- **Voice-clone consent and abuse.** Clone only the account owner's voice, recorded in-app (no file uploads), with a timestamped consent record (voice_profiles.consent_confirmed_at). This is both an ElevenLabs terms requirement and basic liability hygiene.
- **Safety copy.** Entrainment caution for seizure history, no use while driving or operating machinery, not a medical device, sleep-mode volume cap. Ship it in onboarding and the session start screen.
- **Cost blowout.** Minutes ledger enforced server-side via SECURITY DEFINER + `FOR UPDATE`; concurrency proof scripts; 80% usage alerts on the ElevenLabs plan; usage-based billing enabled as buffer, never as baseline.

