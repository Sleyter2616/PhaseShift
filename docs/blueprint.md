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
Inngest job: generate-script
      |
      |-- step 1: Claude call (prompt v2.0 + intake + skeleton givens; v1.4 fallback via env)
      |-- step 2: Zod-validate manifest against skeleton steps/budgets; 1 retry with errors
      |-- step 3: insert script_segments; hash-diff against audio_files (dedupe_key)
      |-- step 4: fan out synthesize-segment jobs for CHANGED segments only
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
      |-- step 5: write actual_duration_sec per segment
      |-- step 6: reconcile phase timing by scaling pause_after_ms from actuals
      |-- step 7: mark script ready
      v
Supabase Realtime -> client (progressive: playback can start once beta+alpha are ready;
                              theta finishes synthesizing during the 8-min induction)
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
    this.toneGain.gain.value = 0.12;   // ~ -18 dB under voice
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

**Defaults.** Carrier 180-220 Hz; tone bed -18 to -24 dB under voice; isochronic is the default mode with a headphones toggle for binaural (device headphone detection is unreliable, so ask, do not sniff). AudioContext must be resumed on a user gesture (iOS requirement): the Begin Session button does it.

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

Prompts live in `src/lib/compiler/prompt.vN.ts`. **Once shipped, a version is immutable** — add `prompt.vN+1.ts` instead of editing.

| Version | Role |
| ------- | ---- |
| **v2.0** (default) | Consumes server skeleton as GIVENS: phase budgets, selected steps + per-step `target_sec`, posture, counted-sequence beat tables. Model fills text for provided slots only. |
| **v1.4** | Legacy full-arc prompt. Retained as fallback via `COMPILER_PROMPT_VERSION=v1.4`. |

Authoritative prompt text: `src/lib/compiler/prompt.v2.ts` (`COMPILER_PROMPT_V2`). Do not paste divergent copies into this blueprint.

**Structural rules (v2.0 summary):**

1. Phase order beta → alpha → theta → gamma; **skip beta when `beta_sec = 0`**.
2. Theta contains **only** `skeleton.steps` (bookended 1 + 12), in order; ≥1 segment per listed step.
3. Per-phase sums of `target_duration_sec` equal skeleton / `session.phase_budget_sec` exactly.
4. Counted sequences (breaths, countdowns, energizing breaths, count-ups) use **server-provided timings verbatim** — the model must not compress them.
5. Present tense in theta; banned modal verbs; verbatim intake placement for **present** steps; ≥20% break time in alpha/theta; WPM ceilings as soft budgets.

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

**Posture** (`sitting` default | `lying`): does **not** change durations. Passthrough into the prompt for body-reference language, theta depth, and gamma intensity.

**Counted sequences:** `buildCountedSequence` returns explicit per-count timings with **enforced** inhale/hold/exhale/pause (or count/pause) beats. Alpha breath/countdown and gamma energizing/count-up timings are server-owned; the model must state them verbatim.

Effective pacing (words per minute, silence included): beta 130, alpha 90, theta 105, gamma 150. Character/COGS estimates scale with length; minutes billing meters `length_min × voice_multiplier` (Section 5).

**Post-synthesis duration reconciliation.** Do not trust the compiler to hit duration through word count. The source of truth is `actual_duration_sec` returned by synthesis. After every segment in a phase is synthesized:

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


API defaults today (wizard step-selection UI lands in **v0.5-2**): length **45**, full middle (`middle_start=2`, `middle_count=10`), posture **sitting**. Server validates via skeleton helpers and rejects invalid combos.

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
Onboard -> record 90s voice sample in-app -> instant clone ready
   -> Intake wizard -> generation (~60-90s, progressive)
   -> Session 1 ... daily playback (cached, offline)
   -> Recognition Log entries accumulate
   -> 3+ matched features -> Re-Triangulate CTA -> goal_version v2
   -> hash-diff regen (~40% of chars) -> Sessions continue
   -> Convergence -> goal marked converged -> next goal
```

The generation pipeline and audio node graphs are in Sections 1.1 and 1.3.

---

## 4. Hosting & Deployment

**Verdict: Vercel + Supabase + Inngest.** The client-side layering decision removed the only workload that would justify AWS (server-side audio mixing).


| Concern            | Where it lives   | Notes                                                                                                                                                                                                                                            |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js app + PWA  | Vercel           | Service worker via serwist; cache manifest + audio segments for offline sessions                                                                                                                                                                 |
| API routes         | Vercel functions | Thin: validate intake, build skeleton, spend minutes, insert rows, enqueue job, return script_id                                                                                                                                                 |
| LLM + TTS work     | Inngest          | All long-running work; concurrency capped to the ElevenLabs plan                                                                                                                                                                                 |
| Auth, DB, Realtime | Supabase         | Realtime channel per script for synthesis progress                                                                                                                                                                                               |
| Audio storage      | Supabase Storage | Private bucket, signed URLs, Smart CDN; user voice assets under `{user_id}/...`, shared stock assets under `shared/...`; TTL defaults to 24h and service worker refreshes signed URLs before expiry; body caching makes repeat plays zero-egress |
| Billing            | Stripe           | Subscriptions + minute top-ups; webhooks call `grant_subscription_minutes` / `grant_topup_minutes` via service role                                                                                                                              |
| Errors             | Sentry           | App Router instrumentation (`@sentry/nextjs`); optional locally via `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`                                                                                                                                      |


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

**Credits (retired from generation):** `credit_balance`, `credit_ledger`, and `spend_credits` still exist for legacy rows/tests but are **not** used by `POST /api/scripts`.

### Pricing structure


| Tier         | Price             | Includes                                                                                                                                 |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Trial        | Free              | Demo / onboarding surfaces; generation requires minutes                                                                                  |
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

- **v0.5-1 (landed):** Server-owned compiler skeleton; length ladder 10/15/30/45; step model B; posture; counted-sequence timing; prompt **v2.0**; minutes charged by length.
- **v0.5-2 (next):** Wizard UI for length + contiguous middle-step selection + posture.
- Later v0.5: Recognition Log / re-triangulate polish; regen copy-through mode (D8).

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

