-- Phase 4a — auth trigger (D19) + refund_credits (D21)
-- profiles_insert_own (0002) remains for direct client inserts; handle_new_user is the
-- source of truth on signup — the policy is harmless if both fire.

-- D19: auto-create profile row when auth.users row is inserted
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- D21: service-role-only credit refund (enqueue failure path)
create or replace function public.refund_credits(
  p_user uuid,
  p_script uuid,
  p_amount numeric
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
  values (p_user, p_amount, 'refund', p_script);
end;
$$;

revoke all on function public.refund_credits(uuid, uuid, numeric) from public;
revoke all on function public.refund_credits(uuid, uuid, numeric) from anon;
revoke all on function public.refund_credits(uuid, uuid, numeric) from authenticated;
