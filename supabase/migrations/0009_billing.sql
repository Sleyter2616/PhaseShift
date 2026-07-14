-- Phase 4c — Stripe billing (D24–D26)
-- Ledger reason mapping: top-up checkout -> purchase; subscription monthly allotment -> grant
-- (credit_ledger.reason already allows purchase, grant, generation, regen, refund)

alter table profiles
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_status text not null default 'none'
    check (subscription_status in ('none','active','past_due','canceled')),
  add column if not exists subscription_tier text
    check (subscription_tier is null or subscription_tier in ('guided','practitioner')),
  add column if not exists subscription_current_period_end timestamptz;

create unique index if not exists profiles_stripe_customer_id_idx
  on profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table stripe_events enable row level security;
-- No policies: clients cannot read/write; service_role bypasses RLS for webhook inserts.

create or replace function public.grant_credits(
  p_user uuid,
  p_amount numeric,
  p_reason text,
  p_script uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 then
    raise exception 'invalid_credit_amount';
  end if;
  if p_reason not in ('purchase', 'grant') then
    raise exception 'invalid_grant_reason';
  end if;

  perform 1
  from profiles
  where id = p_user
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  update profiles
  set credit_balance = credit_balance + p_amount
  where id = p_user;

  insert into credit_ledger (user_id, delta, reason, script_id)
  values (p_user, p_amount, p_reason, p_script);
end;
$$;

revoke all on function public.grant_credits(uuid, numeric, text, uuid) from public;
revoke all on function public.grant_credits(uuid, numeric, text, uuid) from anon;
revoke all on function public.grant_credits(uuid, numeric, text, uuid) from authenticated;
-- service_role only (webhook fulfillment via getServiceClient)
grant execute on function public.grant_credits(uuid, numeric, text, uuid) to service_role;
