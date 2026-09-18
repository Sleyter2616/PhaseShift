-- Make grant_subscription_minutes idempotent for the same billing period so
-- invoice.paid and the stale-reset fallback cannot double-ledger a cycle.
-- Skip when subscription_minutes_reset_at already equals p_period_end
-- (this period was already granted; do not refill a spent balance).

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
  v_reset_at timestamptz;
begin
  if p_minutes is null or p_minutes < 0 then
    raise exception 'invalid_minutes_amount';
  end if;
  if p_period_end is null then
    raise exception 'invalid_period_end';
  end if;

  select subscription_minutes, subscription_minutes_reset_at
  into v_old, v_reset_at
  from profiles
  where id = p_user
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  -- Same period already applied (webhook or fallback). Leave spent balance.
  if v_reset_at is not distinct from p_period_end then
    return;
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
