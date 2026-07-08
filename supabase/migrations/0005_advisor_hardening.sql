-- Source: Supabase advisors on phaseshift-dev, 2026-07-08.
-- Not yet applied — connector applies after this lands.

-- 1. spend_credits: callable only by authenticated role (not public/anon)
revoke execute on function public.spend_credits(uuid, numeric, text) from public;
revoke execute on function public.spend_credits(uuid, numeric, text) from anon;
grant execute on function public.spend_credits(uuid, numeric, text) to authenticated;

-- 2. RLS policies: initplan-cached auth.uid() via (select auth.uid())

alter policy profiles_select_own on profiles
  using (id = (select auth.uid()));

alter policy profiles_insert_own on profiles
  with check (id = (select auth.uid()));

alter policy profiles_update_own on profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy profiles_delete_own on profiles
  using (id = (select auth.uid()));

alter policy voice_profiles_all_own on voice_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy goals_all_own on goals
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy goal_versions_select_own on goal_versions
  using (
    exists (
      select 1 from goals g
      where g.id = goal_versions.goal_id and g.user_id = (select auth.uid())
    )
  );

alter policy goal_versions_insert_own on goal_versions
  with check (
    exists (
      select 1 from goals g
      where g.id = goal_versions.goal_id and g.user_id = (select auth.uid())
    )
  );

alter policy scripts_all_own on scripts
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy script_segments_all_own on script_segments
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy sessions_all_own on sessions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy feature_signals_all_own on feature_signals
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy audio_files_select on audio_files
  using (
    (asset_scope = 'user' and user_id = (select auth.uid())) or
    asset_scope = 'shared'
  );

alter policy credit_ledger_select_own on credit_ledger
  using (user_id = (select auth.uid()));

-- 3. Covering FK indexes (advisor: unindexed foreign keys)

create index if not exists credit_ledger_script_id_idx on credit_ledger(script_id);
create index if not exists credit_ledger_user_id_idx on credit_ledger(user_id);
create index if not exists feature_signals_goal_id_idx on feature_signals(goal_id);
create index if not exists feature_signals_goal_version_id_idx on feature_signals(goal_version_id);
create index if not exists feature_signals_user_id_idx on feature_signals(user_id);
create index if not exists goals_user_id_idx on goals(user_id);
create index if not exists script_segments_audio_file_id_idx on script_segments(audio_file_id);
create index if not exists scripts_goal_version_id_idx on scripts(goal_version_id);
create index if not exists scripts_user_id_idx on scripts(user_id);
create index if not exists scripts_voice_profile_id_idx on scripts(voice_profile_id);
create index if not exists sessions_script_id_idx on sessions(script_id);
create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists voice_profiles_user_id_idx on voice_profiles(user_id);
