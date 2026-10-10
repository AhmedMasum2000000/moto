-- A small public revision signal keeps large content documents off the live channel.
create table public.moto_site_events (
  id boolean primary key default true check(id),
  revision uuid not null references public.moto_revisions(id),
  updated_at timestamptz not null default now()
);
alter table public.moto_site_events enable row level security;
revoke all on public.moto_site_events from anon, authenticated;
grant select on public.moto_site_events to anon, authenticated;
create policy "Published revision is public" on public.moto_site_events
  for select to anon, authenticated using (true);
grant all on public.moto_site_events to service_role;
insert into public.moto_site_events (id,revision,updated_at)
select id,revision,published_at from public.moto_live;
create function private.moto_signal_publication()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.moto_site_events(id,revision,updated_at)
  values(new.id,new.revision,new.published_at)
  on conflict(id) do update set revision=excluded.revision,updated_at=excluded.updated_at;
  return new;
end;
$$;
revoke all on function private.moto_signal_publication() from public,anon,authenticated;
create trigger moto_live_published after insert or update on public.moto_live
for each row execute function private.moto_signal_publication();
alter publication supabase_realtime add table public.moto_site_events;
