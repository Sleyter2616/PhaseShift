-- handle_new_user is a trigger function only; remove its RPC
-- executability (advisor: anon/authenticated security-definer exposure). The
-- trigger runs as table owner regardless of these grants.

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
