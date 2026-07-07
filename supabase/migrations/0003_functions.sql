-- Source: docs/blueprint.md §1.4 (spend_credits SECURITY DEFINER function)
-- Blueprint + prompt version: Phase 0 repo genesis, Phase 0.1 provider-neutral voice layer
-- Amendments applied: none
-- Phase 0.1 note: no changes required — function references profiles/credit_ledger only.

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
