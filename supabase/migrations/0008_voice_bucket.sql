-- Applied out-of-band by conductor 2026-07-11 to unblock; this file is the record.

insert into storage.buckets (id, name, public)
  values ('voice-samples', 'voice-samples', false)
  on conflict (id) do nothing;
