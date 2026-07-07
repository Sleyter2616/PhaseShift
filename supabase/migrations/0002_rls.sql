-- Source: docs/blueprint.md §1.4 (RLS strategy)
-- Blueprint + prompt version: Phase 0 repo genesis, Phase 0.1 provider-neutral voice layer
-- Amendments applied: A2 (script_segments flat owner check via user_id)
-- Phase 0.1 note: no changes required — policies reference user_id / asset_scope only,
--   not columns renamed in A4 (provider_voice_id, provider_request_id, etc.).

alter table profiles enable row level security;
alter table voice_profiles enable row level security;
alter table goals enable row level security;
alter table goal_versions enable row level security;
alter table scripts enable row level security;
alter table script_segments enable row level security;
alter table sessions enable row level security;
alter table feature_signals enable row level security;
alter table audio_files enable row level security;
alter table credit_ledger enable row level security;

-- profiles: owner CRUD
create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

create policy profiles_update_own on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_delete_own on profiles
  for delete using (id = auth.uid());

-- voice_profiles: owner CRUD
create policy voice_profiles_all_own on voice_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- goals: owner CRUD
create policy goals_all_own on goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- goal_versions: SELECT + INSERT only (immutable history)
create policy goal_versions_select_own on goal_versions
  for select using (
    exists (
      select 1 from goals g
      where g.id = goal_versions.goal_id and g.user_id = auth.uid()
    )
  );

create policy goal_versions_insert_own on goal_versions
  for insert with check (
    exists (
      select 1 from goals g
      where g.id = goal_versions.goal_id and g.user_id = auth.uid()
    )
  );

-- scripts: owner CRUD
create policy scripts_all_own on scripts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- script_segments: flat owner check via denormalized user_id (A2)
create policy script_segments_all_own on script_segments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- sessions: owner CRUD
create policy sessions_all_own on sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- feature_signals: owner CRUD
create policy feature_signals_all_own on feature_signals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audio_files: SELECT own user assets + all shared; no client writes
create policy audio_files_select on audio_files
  for select using (
    (asset_scope = 'user' and user_id = auth.uid()) or
    asset_scope = 'shared'
  );

-- credit_ledger: SELECT own rows only; no client writes
create policy credit_ledger_select_own on credit_ledger
  for select using (user_id = auth.uid());
