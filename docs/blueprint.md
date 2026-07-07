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
| 5   | Pricing                 | Hybrid: subscription base + metered generation credits                                                                   | Playback is near-zero marginal cost and must feel unlimited (daily habit); generation costs real dollars per session and must be metered                                                                        |


---

## 1. Application Scaffolding & Architecture

### 1.1 End-to-end data flow

```
Intake Wizard (7 screens)
      |
      | intake JSON (Zod-validated client + server)
      v
POST /api/scripts
      |  writes goal_version + script(status=generating), returns script_id immediately
      v
Inngest job: generate-script
      |
      |-- step 1: Claude call (compiler system prompt + intake vars)
      |-- step 2: Zod-validate manifest; on fail, 1 retry with validator errors appended
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
A 40-minute session is ~90-140 TTS seconds of API work plus a 15-30 second Claude call. None of that belongs in a route handler regardless of platform timeouts. Inngest gives you per-step retries, fan-out with a concurrency cap matched to your ElevenLabs plan, dead-letter visibility, and status writes the client consumes over Realtime. Trigger.dev is an equivalent choice; pgmq on Supabase works if you want zero extra vendors, at the cost of building retry semantics yourself.

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

**Scheduling.** Compute each segment's start offset from the running sum of actual_duration_sec + pause_after_ms (actuals come back from synthesis, so timing is exact, not estimated). Use a lookahead scheduler (setInterval ~200 ms, schedule 2-3 s ahead on the AudioContext clock) rather than starting all 40 minutes of sources at once.

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

Expected output size: 128 kbps MP3 is ~38 MB for 40 minutes. Cache by `script_id + render_settings_hash`, because binaural/isochronic mode, carrier, tone gain, and voice gain change the rendered result.

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
  credit_balance numeric not null default 0 check (credit_balance >= 0),
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

create table credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id),
  delta numeric not null,                  -- generation credits; negative = spend
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

-- credit_ledger: no client write policies at all. Balance is not computed by
-- locking sum(delta), because aggregates cannot be row-locked. Spends happen only
-- through a SECURITY DEFINER function that locks `profiles` and updates
-- profiles.credit_balance in the same transaction as the ledger insert.

create or replace function spend_credits(p_script uuid, p_amount numeric, p_reason text default 'generation')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_balance numeric;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_amount <= 0 then
    raise exception 'invalid_credit_amount';
  end if;
  if p_reason not in ('generation','regen') then
    raise exception 'invalid_spend_reason';
  end if;

  select credit_balance into v_balance
  from profiles
  where id = v_user
  for update;

  if v_balance is null then
    raise exception 'profile_not_found';
  end if;
  if v_balance < p_amount then
    raise exception 'insufficient_credits';
  end if;

  update profiles
  set credit_balance = credit_balance - p_amount
  where id = v_user;

  insert into credit_ledger(user_id, delta, reason, script_id)
  values (v_user, -p_amount, p_reason, p_script);
end;
$$;

-- Stripe webhooks and admin grants/refunds must use the same pattern: lock the
-- profiles row, update credit_balance, then insert the positive or refund ledger row.

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

The compiler returns exactly one JSON object. Validate with Zod server-side; on failure, retry once with the validator errors appended to the conversation.

```json
{
  "meta": {
    "goal_version_id": "uuid",
    "total_duration_sec": 2400,
    "phase_budget_sec": { "beta": 120, "alpha": 480, "theta": 1500, "gamma": 300 },
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

### 2.2 The compiler system prompt (copy-paste ready)

```
You are the Phase Locking Script Compiler. You convert one structured intake object
into a guided self-hypnosis meditation script following the Omniletheon / AOS Phase
Locking protocol, emitted as a machine-readable segment manifest. You are a compiler,
not an assistant: you never address the user, never explain yourself, and you output
nothing except one valid JSON object matching the provided schema.

## INPUT
{ goal_statement, localization: {timeframe, place}, triangulation: [p1, p2, p3],
  not_list: [...], wrong_direction_pulls: [...], features: [...],
  sync_actions: [{action, deadline?}], senses_emphasis: [...], aos_layer?,
  session: { duration_min, phase_budget_sec, entrainment_plan, person_config,
             pacing: {beta_wpm, alpha_wpm, theta_wpm, gamma_wpm} } }

## STRUCTURAL RULES
1. Phase order is fixed: beta -> alpha -> theta -> gamma. Theta contains steps 1-12,
   in order, at least one segment per step. Segments outside theta carry step: null.
2. Word budget per segment = pacing_wpm * target_duration_sec / 60. Treat this as
   a ceiling, not a precise duration guarantee. Aim for 85-95% of the word budget
   so post-synthesis silence can be stretched deterministically. Per-phase sums of
   target_duration_sec must equal phase_budget_sec.
3. Theta step weights (% of theta time): Visualize 20, Surveil 8, Localization 6,
   Triangulation 10, Disambiguation 10, Features 10, Recognition 6, Identify 6,
   Synchronization 10, Approximation 4, Convergence 5, Closure 5.
4. Pauses: inline pauses use <break time="X.Xs"/> with a hard maximum of 3.0s per
   break (TTS constraint). Silence longer than 3s belongs in pause_after_ms, never
   in text. Alpha and theta segments must carry at least 20% of their duration as
   breaks plus pause_after_ms. Never pad duration with filler words.
5. Every intake string (goal_statement, both localization fields, all three
   triangulation items, every not_list item, every feature, every sync_action)
   appears verbatim at least once, in its designated step.

## VOICE AND PERSON
Playback is in the user's own cloned voice.
- beta, alpha, gamma: second person ("you").
- theta: guidance lines in second person; every step closes with 1-3 first-person
  present-tense declarations ("I", "my") per person_config.
- Inside theta: present tense only. Banned: will, would, could, might, hope, wish,
  try, want, someday.

## TONE
- Hard logical ground. Concrete nouns, spatial precision, measurable references.
  Sensory language is dense and specific, never vague.
- Banned vocabulary: "the universe" as an agent, vibrations, energy as a substance,
  higher self, manifest your destiny, just, maybe, perhaps, simply.
- Esoteric terms are technical vocabulary, used only as defined: perspectival
  collapse (deliberate lens shift), protospective horizon (imaginal future field),
  convergence (goal interception), NooAeonic aperture (perceptual bandwidth).
  Do not improvise new esoteric terms.

## STEP SPECIFICATIONS (theta)
| Step | Perspective | Horizon | Archetype | Requirements |
|---|---|---|---|---|
| 1 Visualize | first | protospective | trickster | Build the scene at {place} within {timeframe}. Minimum 4 senses, senses_emphasis first. One explicit timeline-traversal beat: felt movement from now to the scene. |
| 2 Surveil | third then first | protospective | creator | Instruct the listener to speak {goal_statement} aloud, hold a 3.0s break, then restate it back. Second pass sharpens anything vague from step 1. |
| 3 Localization | third | protospective | none | State {timeframe} and {place} verbatim. Anchor with one spatial detail and one calendar detail. |
| 4 Triangulation | third | protospective + retrospective | none | Name all three prerequisites verbatim as three fixed points around the outcome. For any prerequisite already in motion, one retrospective line acknowledging progress. |
| 5 Disambiguation | second | introspective | warrior | Name each not_list item and dismiss it in one clean line each. Invoke the Warrior against each wrong_direction_pull: boundary language, no aggression theater. |
| 6 Features Extraction | third | protospective | none | Enumerate every feature verbatim as an observable near-term signal: one line each for what it looks like and where it tends to appear. |
| 7 Recognition | first | introspective | none | Rehearse noticing each feature inside an ordinary moment of the day. |
| 8 Identify | first | introspective | thief | First-person declarations that the visualization is arriving. Ownership language: outcomes belong to the speaker. |
| 9 Synchronization | first + second | protospective | magician | Walk each sync_action as embodied rehearsal: the body performing it, when, where. |
| 10 Approximation | first | protospective | none | Brief compressed re-run: one line each re-touching steps 1, 4, and 6 from the shifted, closer perspective. |
| 11 Convergence | first | protospective collapsing to introspective | none | Interception scene at maximum sensory density. The imaginal image and the present moment close to zero distance. |
| 12 Closure | first | introspective | thief | Felt accomplishment. Lock-in declarations. No gratitude-to-external-agent language. |

## ALPHA (induction)
Slow breathing with extended exhales (state ratios, e.g. in 4, out 8), progressive
muscle tension-release cycles moving feet to face, slow countdown 10 to 1. Calm
imperative. The stated purpose: releasing tension frees nervous system resources
for the work ahead.

## GAMMA (exit)
Energizing breath protocol (3 rounds of 20 fast nasal breaths with brief holds),
count-up 1 to 5 with escalating physical cues, then direct the listener into
sync_actions[0] as the immediate next physical act after the session. 140-160 wpm,
imperative, high energy.

## SELF-CHECK (run before emitting)
1. JSON valid against schema. 2. Phase sums equal phase_budget_sec. 3. Per-segment
word counts do not exceed the calculated budget and usually land at 85-95% of it.
4. All intake strings present verbatim. 5. No banned tokens. 6. Theta contains all
12 steps in order.
If any check fails, fix and re-emit. Output only the final JSON.
```

### 2.3 Duration and word budgets

Phase budgets by preset (seconds):


| Preset | Beta | Alpha | Theta | Gamma |
| ------ | ---- | ----- | ----- | ----- |
| 20 min | 60   | 240   | 780   | 120   |
| 30 min | 90   | 360   | 1140  | 210   |
| 40 min | 120  | 480   | 1500  | 300   |
| 60 min | 180  | 720   | 2340  | 360   |


Effective pacing (words per minute, silence included): beta 130, alpha 90, theta 105, gamma 150. A 40-minute session therefore budgets roughly 260 + 720 + 2,625 + 750 = ~4,355 words as an upper bound, or ~25,700 characters, plus ~1,300 characters of break tags: call it 27,000 billable characters per full generation. This number drives Section 5.

**Post-synthesis duration reconciliation.** Do not trust the compiler to hit duration through word count. The source of truth is `actual_duration_sec` returned by synthesis. After every segment in a phase is synthesized:

```ts
for (const phase of phases) {
  const segments = byPhase[phase];
  const budgetSec = phaseBudgetSec[phase];
  const voicedSec = sum(segments.map(s => s.actual_duration_sec));
  const rawPauseMs = sum(segments.map(s => s.pause_after_ms));
  const remainingMs = Math.max(0, budgetSec * 1000 - voicedSec * 1000);

  if (rawPauseMs > 0) {
    const scale = remainingMs / rawPauseMs;
    for (const s of segments) {
      s.scheduled_pause_after_ms = Math.round(s.pause_after_ms * scale);
    }
  } else {
    const perGap = Math.round(remainingMs / Math.max(1, segments.length - 1));
    for (const [i, s] of segments.entries()) {
      s.scheduled_pause_after_ms = i === segments.length - 1 ? 0 : perGap;
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
| 7      | duration, entrainment_mode, voice, senses_emphasis, aos_layer | selects                        | defaults: 40 min, isochronic, at least 2 senses; aos_layer under an Advanced toggle          | meta             |


Design principle: chips and fixed-count inputs keep every intake item atomic, so the compiler can quote them verbatim (rule 5 in the prompt). The user's exact words appear in their own voice during the session. This is the Daath principle operationalized: reality quality reflects communication quality, so the app never paraphrases the user.

---

## 3. Visuals & Flow

State progression timeline (40-min preset):

```
0        2                10                                       35        40 min
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
| API routes         | Vercel functions | Thin: validate intake, insert rows, enqueue job, return script_id                                                                                                                                                                                |
| LLM + TTS work     | Inngest          | All long-running work; concurrency capped to the ElevenLabs plan                                                                                                                                                                                 |
| Auth, DB, Realtime | Supabase         | Realtime channel per script for synthesis progress                                                                                                                                                                                               |
| Audio storage      | Supabase Storage | Private bucket, signed URLs, Smart CDN; user voice assets under `{user_id}/...`, shared stock assets under `shared/...`; TTL defaults to 24h and service worker refreshes signed URLs before expiry; body caching makes repeat plays zero-egress |
| Billing            | Stripe           | Subscriptions + credit top-ups; webhooks write credit_ledger via service role                                                                                                                                                                    |


Fixed infra at small scale: Vercel Pro $20 + Supabase Pro $25 + Inngest $0-20, roughly $50-70/month before TTS. Secrets (Anthropic, ElevenLabs) live server-side only.

Move to AWS/GCP only when one of these appears: server-side mixing (ffmpeg pipelines), egress measured in terabytes (S3 + CloudFront wins), or bringing TTS in-house. Build a thin TTSProvider interface from day one so ElevenLabs can be swapped for Cartesia or PlayHT without touching the pipeline; pricing and terms in this market move quarterly.

---

## 5. Monetization & Pricing Strategy

### Cost model and voice-quality gate

Current plan math must be verified at implementation time because TTS pricing and model terms move. Working assumption from the current model: Multilingual v2 is the high-fidelity/studio path and costs roughly 2x Flash/Turbo for the same character count; Flash/Turbo remains the intended default only if own-voice clone fidelity is good enough.

Per full 40-minute generation (~27,000 billable characters):


| Model                                         | Credits | Cost at Pro base (~$0.165/1k) | Cost at Creator base (~$0.182/1k) |
| --------------------------------------------- | ------- | ----------------------------- | --------------------------------- |
| Flash v2.5 candidate default                  | 13,500  | ~$2.25                        | ~$2.46                            |
| Multilingual v2 fallback default / studio     | 27,000  | ~$4.46                        | ~$4.91                            |
| Re-triangulation regen (~40% of chars, Flash) | ~5,400  | ~$0.90                        | ~$0.98                            |
| Re-triangulation regen (~40% of chars, v2)    | ~10,800 | ~$1.78                        | ~$1.96                            |


**Do not lock pricing until instant-clone fidelity is tested.** The product promise is not generic meditation audio; it is the user's own voice. Before freezing tiers, run a small eval harness:

- 10-20 users, each with the same 90-second in-app voice sample.
- Generate matched 60-90 second script excerpts in Flash v2.5 and Multilingual v2.
- Blind A/B ratings: voice similarity, naturalness, emotional acceptability, and “would I meditate to this daily?”
- Ship Flash as default only if at least 80% rate it acceptable and the v2 preference gap is small. If v2 wins clearly, make v2 the default for cloned voices and keep Flash for stock/demo voices or low-cost previews.

Pricing consequence if v2 becomes default: Guided worst case roughly doubles from ~$9-10 to ~$18-20 COGS against $29. That is still workable, but thin. In that case, change Guided from 4 credits/mo to 3 credits/mo, keep re-triangulation at 0.5 credit only when the changed-character estimate stays under 12k, and reserve full 10-credit generosity for Practitioner.

Capacity: the Pro plan ($99) covers ~44 Flash or ~22 v2 full generations per month under the current working math. Start on Creator, move to Pro past ~8 full generations/month, enable usage-based billing as a buffer with an 80% usage alert.

Voice cloning: Instant Voice Cloning (90s in-app sample) is the MVP path. Professional Voice Cloning is a premium upgrade only after the eval shows that users care enough to pay for the fidelity delta.

### Pricing structure: hybrid (subscription + generation credits)

Meter creation, not consumption. Playback must feel unlimited because daily practice is the product; generation costs real dollars and gets a credit system.


| Tier         | Price             | Includes                                                                                                                                                                                                                              |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trial        | Free              | One pre-rendered demo session in a stock voice (zero marginal cost per signup), full player UX, intake preview                                                                                                                        |
| Guided       | $29/mo or $290/yr | Instant voice clone, 4 generation credits/mo if Flash passes fidelity gate; 3 credits/mo if v2 must be default; unlimited playback; Recognition Log; re-triangulation regens at 0.5 credit when under the changed-character threshold |
| Practitioner | $49/mo or $490/yr | 10 credits/mo, Freeform mode (custom sequencing and durations), Delta research mode, studio-quality v2 voice option, priority queue, multiple concurrent goals                                                                        |
| Top-up       | $6 per credit     | 1 credit = one Flash generation up to 30k chars; v2 generation = 2 credits                                                                                                                                                            |


Margin check: if Flash passes the fidelity gate, Guided worst case is 4 Flash generations, ~$9-10 COGS against $29. If v2 must be default, Guided should drop to 3 included credits, because 4 v2 generations can push COGS toward ~$18-20. Practitioner worst case remains workable because the tier can explicitly meter v2 as 2 credits per generation. Median users generate 1-2 scripts per month and play daily, so realized margins run higher than worst case.

**Answer to the open question (freeform paywall):** do not make Guided free. The guided guardrail product IS the paid base tier; Freeform is the Practitioner gate, alongside Delta and studio voice quality. The only free surface is the pre-rendered demo, which has zero marginal cost and demonstrates the full experience including the exit state.

Why hybrid beats the alternatives: a pure subscription invites generation-heavy users to blow out COGS; pure credits make daily playback feel metered and kill the habit loop. Hybrid prices the two cost structures separately.

---

## 6. MVP Cutline & Roadmap

**v0 (weeks 1-6): the guarded core.**
Guided mode only. Fixed 40-min template. Instant voice clone from a 90-second in-app reading (plus 2 stock voices as fallback). Isochronic default with binaural toggle. Foreground playback with wake lock. Sessions log with exit-alertness rating. Stripe single tier. Compiler prompt v1 pinned in prompt_version.

**v0.5 (weeks 7-10): the loop.**
Recognition Log with matched-feature tracking. Re-Triangulate flow with hash-diff regen. 20/30/60-minute presets.

**v1 (weeks 11-16): retention and the second tier.**
Per-phase block editor (the state-chunking UI). Offline render + true background playback (`OfflineAudioContext -> PCM -> Worker encoder -> cached Blob -> HTMLAudioElement + MediaSession`). Practitioner tier with credit ledger and Freeform sequencing.

**v1.5+: Delta research mode.**
Design that respects the hard-logical-ground standard: the literature does not support learning novel verbal content in deep sleep, but Targeted Memory Reactivation (re-cueing material learned while awake) has real evidence. So Delta mode is replay, not programming: during Theta sessions, each first-person declaration is preceded by a short signature audio motif unique to the goal. Delta mode runs as a sleep-timer session that plays only those motifs (optionally the declarations at whisper level, capped around -30 dB) on a spaced schedule during the first ~3 hours of sleep, when slow-wave sleep dominates. Experiment design: within-subject A/B, alternating cued and silent nights over two weeks, measuring recognition-log entries per day and a morning free-recall check of the declarations. Architecture already accommodates it: delta segments carry an anchor_ref instead of text, the engine plays arbitrary buffers, and the only additions are a sleep timer and a volume cap.

---

## 7. Risk Register

- **iOS background audio.** Solved structurally in v1 by the offline render; v0 is screen-on by design and says so in onboarding.
- **TTS vendor drift.** Prices, terms, and models move quarterly. The dedupe cache, Flash-default policy, and TTSProvider abstraction cap the blast radius.
- **Voice-clone consent and abuse.** Clone only the account owner's voice, recorded in-app (no file uploads), with a timestamped consent record (voice_profiles.consent_confirmed_at). This is both an ElevenLabs terms requirement and basic liability hygiene.
- **Safety copy.** Entrainment caution for seizure history, no use while driving or operating machinery, not a medical device, sleep-mode volume cap. Ship it in onboarding and the session start screen.
- **Cost blowout.** Credit ledger enforced server-side via SECURITY DEFINER function; 80% usage alerts on the ElevenLabs plan; usage-based billing enabled as buffer, never as baseline.

