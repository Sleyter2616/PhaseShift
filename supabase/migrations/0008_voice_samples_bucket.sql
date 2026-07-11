-- Phase 4b.2 — private bucket for in-app voice clone samples

insert into storage.buckets (id, name, public)
  values ('voice-samples', 'voice-samples', false)
  on conflict (id) do nothing;
