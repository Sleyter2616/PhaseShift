-- Phase 9a — two-pool minutes billing engine (schema + SQL functions only).
-- Credits system remains untouched. Stripe/webhook/UI wiring is Phase 9b.
--
-- VOICE_MULTIPLIER: stock = 1, own_voice = 2 (see minutes_cost).
-- Session cost today: length 40 → stock 40 min, own voice 80 min.
-- Deduction order: subscription_minutes first, then topup_minutes.

alter table profiles
  add column if not exists subscription_minutes integer not null default 0
    check (subscription_minutes >= 0),
  add column if not exists subscription_minutes_reset_at timestamptz,
  add column if not exists topup_minutes integer not null default 0
    check (topup_minutes >= 0);

comment on column profiles.subscription_minutes is
  'Monthly tier minutes; reset (not accumulated) each billing cycle via grant_subscription_minutes.';
comment on column profiles.subscription_minutes_reset_at is
  'End of the current subscription minutes period (period end from Stripe invoice).';
comment on column profiles.topup_minutes is
  'Purchased minutes that never expire; spent after subscription_minutes.';

create table if not exists minutes_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  delta integer not null,
  pool text not null check (pool in ('subscription', 'topup')),
  reason text not null check (reason in ('grant', 'purchase', 'spend', 'refund', 'reset')),
  script_id uuid references scripts(id),
  created_at timestamptz not null default now()
);

create index if not exists minutes_ledger_user_id_idx on minutes_ledger (user_id);
create index if not exists minutes_ledger_script_id_idx on minutes_ledger (script_id);

alter table minutes_ledger enable row level security;

create policy minutes_ledger_select_own on minutes_ledger
  for select
  using (user_id = (select auth.uid()));
-- No client insert/update/delete — SECURITY DEFINER functions only.

-- Pure cost helper. VOICE_MULTIPLIER: stock=1, own_voice=2.
create or replace function public.minutes_cost(
  length_minutes integer,
  is_own_voice boolean
)
returns integer
language sql
immutable
security invoker
set search_path = public
as $$
  select length_minutes * (case when is_own_voice then 2 else 1 end);
$$;

comment on function public.minutes_cost(integer, boolean) is
  'Session cost in minutes = length_minutes * VOICE_MULTIPLIER (stock=1, own_voice=2).';

revoke all on function public.minutes_cost(integer, boolean) from public;
revoke all on function public.minutes_cost(integer, boolean) from anon;
grant execute on function public.minutes_cost(integer, boolean) to authenticated;
grant execute on function public.minutes_cost(integer, boolean) to service_role;

-- Deduct subscription-first, then topup. Check before mutate. Auth: p_user = auth.uid().
create or replace function public.spend_minutes(
  p_user uuid,
  p_minutes integer,
  p_script uuid default null,
  out subscription_spent integer,
  out topup_spent integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_sub integer;
  v_top integer;
begin
  if v_caller is null then
    raise exception 'not_authenticated';
  end if;
  if p_user is distinct from v_caller then
    raise exception 'forbidden_user';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'invalid_minutes_amount';
  end if;

  select subscription_minutes, topup_minutes
  into v_sub, v_top
  from profiles
  where id = p_user
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if (v_sub + v_top) < p_minutes then
    raise exception 'insufficient_minutes';
  end if;

  subscription_spent := least(v_sub, p_minutes);
  topup_spent := p_minutes - subscription_spent;

  update profiles
  set
    subscription_minutes = subscription_minutes - subscription_spent,
    topup_minutes = topup_minutes - topup_spent
  where id = p_user;

  if subscription_spent > 0 then
    insert into minutes_ledger (user_id, delta, pool, reason, script_id)
    values (p_user, -subscription_spent, 'subscription', 'spend', p_script);
  end if;

  if topup_spent > 0 then
    insert into minutes_ledger (user_id, delta, pool, reason, script_id)
    values (p_user, -topup_spent, 'topup', 'spend', p_script);
  end if;
end;
$$;

revoke all on function public.spend_minutes(uuid, integer, uuid) from public;
revoke all on function public.spend_minutes(uuid, integer, uuid) from anon;
revoke all on function public.spend_minutes(uuid, integer, uuid) from service_role;
grant execute on function public.spend_minutes(uuid, integer, uuid) to authenticated;

-- Refund into a single pool (caller passes pools from spend breakdown).
create or replace function public.refund_minutes(
  p_user uuid,
  p_minutes integer,
  p_pool text,
  p_script uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'invalid_minutes_amount';
  end if;
  if p_pool not in ('subscription', 'topup') then
    raise exception 'invalid_minutes_pool';
  end if;

  perform 1
  from profiles
  where id = p_user
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if p_pool = 'subscription' then
    update profiles
    set subscription_minutes = subscription_minutes + p_minutes
    where id = p_user;
  else
    update profiles
    set topup_minutes = topup_minutes + p_minutes
    where id = p_user;
  end if;

  insert into minutes_ledger (user_id, delta, pool, reason, script_id)
  values (p_user, p_minutes, p_pool, 'refund', p_script);
end;
$$;

revoke all on function public.refund_minutes(uuid, integer, text, uuid) from public;
revoke all on function public.refund_minutes(uuid, integer, text, uuid) from anon;
revoke all on function public.refund_minutes(uuid, integer, text, uuid) from authenticated;
grant execute on function public.refund_minutes(uuid, integer, text, uuid) to service_role;

-- Reset subscription pool for a billing period (SETS, does not add).
create or replace function public.grant_subscription_minutes(
  p_user uuid,
  p_minutes integer,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
begin
  if p_minutes is null or p_minutes < 0 then
    raise exception 'invalid_minutes_amount';
  end if;
  if p_period_end is null then
    raise exception 'invalid_period_end';
  end if;

  select subscription_minutes
  into v_old
  from profiles
  where id = p_user
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if v_old > 0 then
    insert into minutes_ledger (user_id, delta, pool, reason, script_id)
    values (p_user, -v_old, 'subscription', 'reset', null);
  end if;

  update profiles
  set
    subscription_minutes = p_minutes,
    subscription_minutes_reset_at = p_period_end
  where id = p_user;

  if p_minutes > 0 then
    insert into minutes_ledger (user_id, delta, pool, reason, script_id)
    values (p_user, p_minutes, 'subscription', 'grant', null);
  end if;
end;
$$;

revoke all on function public.grant_subscription_minutes(uuid, integer, timestamptz) from public;
revoke all on function public.grant_subscription_minutes(uuid, integer, timestamptz) from anon;
revoke all on function public.grant_subscription_minutes(uuid, integer, timestamptz) from authenticated;
grant execute on function public.grant_subscription_minutes(uuid, integer, timestamptz) to service_role;

-- Add purchased top-up minutes (never expire).
create or replace function public.grant_topup_minutes(
  p_user uuid,
  p_minutes integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'invalid_minutes_amount';
  end if;

  perform 1
  from profiles
  where id = p_user
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  update profiles
  set topup_minutes = topup_minutes + p_minutes
  where id = p_user;

  insert into minutes_ledger (user_id, delta, pool, reason, script_id)
  values (p_user, p_minutes, 'topup', 'purchase', null);
end;
$$;

revoke all on function public.grant_topup_minutes(uuid, integer) from public;
revoke all on function public.grant_topup_minutes(uuid, integer) from anon;
revoke all on function public.grant_topup_minutes(uuid, integer) from authenticated;
grant execute on function public.grant_topup_minutes(uuid, integer) to service_role;
