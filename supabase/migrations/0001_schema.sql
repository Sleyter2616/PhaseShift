-- Source: docs/blueprint.md §1.4 (Supabase schema DDL)
-- Blueprint + prompt version: Phase 0 repo genesis, Phase 0.1 provider-neutral voice layer
-- Amendments applied: A1 (dedupe scope), A2 (script_segments.user_id), A3 (dedupe provider),
--   A4 (tts_provider enum, provider-neutral columns, voice_source_xor), A5 (break stripping in app layer)

create type phase as enum ('beta','alpha','theta','gamma','delta');
create type pl_perspective as enum ('first','second','third');
create type horizon as enum ('introspective','retrospective','protospective');
create type archetype as enum ('child','trickster','warrior','thief','magician','creator');
create type audio_asset_scope as enum ('user','shared');
create type tts_provider as enum ('elevenlabs','openai','google','amazon','inworld','minimax','selfhost');

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
  provider tts_provider not null default 'elevenlabs',
  provider_voice_id text,
  status text not null default 'pending' check (status in ('pending','ready','failed')),
  consent_confirmed_at timestamptz,
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

create table goal_versions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  version int not null,
  localization_timeframe text not null,
  localization_place text not null,
  triangulation jsonb not null,
  not_list jsonb not null,
  wrong_direction_pulls jsonb,
  features jsonb not null,
  sync_actions jsonb not null,
  created_at timestamptz default now(),
  unique (goal_id, version)
);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  goal_version_id uuid not null references goal_versions(id),
  provider tts_provider not null default 'elevenlabs',
  voice_profile_id uuid references voice_profiles(id),
  stock_voice_id text,
  llm_model text,
  prompt_version text,
  entrainment_mode text not null default 'isochronic'
    check (entrainment_mode in ('binaural','isochronic')),
  person_config jsonb not null default '{"induction":"second","theta_declarations":"first"}',
  status text not null default 'generating'
    check (status in ('generating','synthesizing','ready','failed')),
  total_duration_sec int,
  created_at timestamptz default now(),
  constraint voice_source_xor check (
    (voice_profile_id is not null)::int + (stock_voice_id is not null)::int = 1
  )
);

create table audio_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  asset_scope audio_asset_scope not null default 'user',
  provider tts_provider not null,
  dedupe_key text not null,
  storage_path text not null,
  duration_sec numeric,
  bytes int,
  format text default 'mp3',
  provider_request_id text,
  created_at timestamptz default now(),
  check (
    (asset_scope = 'user' and user_id is not null) or
    (asset_scope = 'shared' and user_id is null)
  )
);

create unique index audio_files_user_dedupe_idx
  on audio_files(user_id, dedupe_key)
  where asset_scope = 'user';

create unique index audio_files_shared_dedupe_idx
  on audio_files(dedupe_key)
  where asset_scope = 'shared';

create table script_segments (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts(id) on delete cascade,
  user_id uuid not null references profiles(id),
  seq int not null,
  phase phase not null,
  step int check (step between 1 and 12),
  title text,
  perspective pl_perspective,
  temporal_horizon horizon,
  archetype archetype,
  text text not null,
  target_duration_sec int not null,
  actual_duration_sec numeric,
  pacing_wpm int not null,
  pause_after_ms int not null default 0,
  scheduled_pause_after_ms int,
  entrainment_hz numeric not null,
  glide_to_hz numeric,
  content_hash text not null,
  audio_file_id uuid references audio_files(id),
  synthesis_status text not null default 'pending'
    check (synthesis_status in ('pending','processing','ready','failed')),
  unique (script_id, seq)
);

create index script_segments_user_id_idx on script_segments(user_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  script_id uuid not null references scripts(id),
  started_at timestamptz default now(),
  completed_at timestamptz,
  progress_sec int default 0,
  exit_alertness int check (exit_alertness between 1 and 5),
  notes text
);

create table feature_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  goal_id uuid not null references goals(id),
  goal_version_id uuid references goal_versions(id),
  signal_text text not null,
  matched_feature text,
  logged_at timestamptz default now()
);

create table credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id),
  delta numeric not null,
  reason text not null check (reason in ('purchase','grant','generation','regen','refund')),
  script_id uuid references scripts(id),
  created_at timestamptz default now()
);
