-- First-run onboarding: set when the user completes /welcome.
-- NULL means show /welcome after auth; returning users have a timestamp.

alter table profiles
  add column if not exists onboarded_at timestamptz;
