-- Photo library details: a display name, a default picture description (alt text) and a
-- "hidden from library" flag, edited through the moto-admin media-update action.
-- moto_media.name already exists (the original file name); "if not exists" keeps this safe.
alter table public.moto_media
  add column if not exists name text,
  add column if not exists alt text,
  add column if not exists hidden boolean not null default false;

-- Display names are edited up to 120 characters (moto-admin enforces it). The database limit stays at
-- 200 so files registered with the existing upload limit (names under 200 characters) still insert;
-- "not valid" skips the check for rows that already exist.
alter table public.moto_media drop constraint if exists moto_media_name_length_check;
alter table public.moto_media add constraint moto_media_name_length_check
  check (name is null or char_length(name) <= 200) not valid;
alter table public.moto_media drop constraint if exists moto_media_alt_length_check;
alter table public.moto_media add constraint moto_media_alt_length_check
  check (alt is null or char_length(alt) <= 150) not valid;

create index if not exists moto_media_hidden_idx on public.moto_media(hidden);

-- Same access as the rest of moto_media: only the service role (the moto-admin function) reads or writes.
revoke all on public.moto_media from anon, authenticated;
grant all on public.moto_media to service_role;
