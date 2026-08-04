-- First-session primer: NULL means show the how-to gate once before playback.
-- Set when the user dismisses the primer ("I'm ready").

alter table profiles
  add column if not exists primer_seen_at timestamptz;

comment on column profiles.primer_seen_at is
  'When the user dismissed the first-session primer; NULL = show once before playback';
