-- Store a small, pre-compressed Owner profile image on the private profile row.
-- This is separate from workspace snapshots, so a business reset preserves it.
alter table public.user_profiles
  add column if not exists avatar_data text;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_profiles'::regclass
      and conname = 'user_profiles_avatar_data_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_avatar_data_check
      check (
        avatar_data is null or (
          length(avatar_data) <= 22000
          and avatar_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
        )
      );
  end if;
end
$migration$;
