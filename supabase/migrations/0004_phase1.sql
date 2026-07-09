-- Phase 1 pipeline additions (D7)
-- Applied via Supabase connector to hosted dev; do not edit 0001–0003.

alter table scripts add column if not exists error_message text;
alter table scripts add column if not exists compiler_input jsonb;

alter publication supabase_realtime add table scripts;

insert into storage.buckets (id, name, public)
  values ('audio', 'audio', false)
  on conflict (id) do nothing;
