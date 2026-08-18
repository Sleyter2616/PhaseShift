-- One voice profile per user. Prefer a real ready clone when deduping.
-- Keep the best row per user_id, re-point scripts, then enforce uniqueness.

with ranked as (
  select
    id,
    user_id,
    row_number() over (
      partition by user_id
      order by
        case
          when status = 'ready'
            and provider_voice_id is not null
            and provider_voice_id not like 'mock-clone-%'
            then 0
          when status = 'ready' then 1
          when status = 'pending' then 2
          else 3
        end,
        created_at desc nulls last
    ) as rn
  from voice_profiles
),
keepers as (
  select id, user_id from ranked where rn = 1
),
dupes as (
  select r.id as dupe_id, k.id as keep_id
  from ranked r
  join keepers k on k.user_id = r.user_id
  where r.rn > 1
)
update scripts s
set voice_profile_id = d.keep_id
from dupes d
where s.voice_profile_id = d.dupe_id;

with ranked as (
  select
    id,
    user_id,
    row_number() over (
      partition by user_id
      order by
        case
          when status = 'ready'
            and provider_voice_id is not null
            and provider_voice_id not like 'mock-clone-%'
            then 0
          when status = 'ready' then 1
          when status = 'pending' then 2
          else 3
        end,
        created_at desc nulls last
    ) as rn
  from voice_profiles
)
delete from voice_profiles
where id in (select id from ranked where rn > 1);

create unique index if not exists voice_profiles_user_id_unique
  on voice_profiles (user_id);
