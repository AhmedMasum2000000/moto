-- Moto Control: staff-only drafts, immutable publications, private uploads.
create schema if not exists private;
create table public.moto_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('owner','editor','service')),
  can_publish boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.moto_draft (
  id boolean primary key default true check (id),
  content jsonb not null check(jsonb_typeof(content)='object'),
  changes jsonb not null default '[]' check(jsonb_typeof(changes)='array'),
  version bigint not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.moto_revisions (
  id uuid primary key default gen_random_uuid(),
  content jsonb not null,
  public_content jsonb not null,
  summary text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.moto_live (
  id boolean primary key default true check(id),
  revision uuid not null references public.moto_revisions(id),
  content jsonb not null,
  published_at timestamptz not null default now()
);
create table public.moto_media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  name text not null,
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  size_bytes integer not null check(size_bytes between 1 and 5242880),
  width integer not null check(width between 1 and 12000),
  height integer not null check(height between 1 and 12000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.moto_requests (
  id uuid primary key default gen_random_uuid(),
  receipt text not null unique,
  idempotency_key uuid not null unique,
  kind text not null check(kind in ('order','booking')),
  customer_name text not null,
  phone text not null,
  details jsonb not null,
  status text not null default 'new' check(status in ('new','contacted','confirmed','completed','cancelled')),
  staff_notes text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table public.moto_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table private.moto_request_limits (
  key text primary key,
  count integer not null default 1,
  window_started timestamptz not null default now()
);
create index moto_requests_created_idx on public.moto_requests(created_at desc);
create index moto_requests_status_idx on public.moto_requests(status);
create index moto_revisions_created_idx on public.moto_revisions(created_at desc);
create index moto_media_created_by_idx on public.moto_media(created_by);
create index moto_audit_actor_idx on public.moto_audit(actor);
alter table public.moto_staff enable row level security;
alter table public.moto_draft enable row level security;
alter table public.moto_revisions enable row level security;
alter table public.moto_live enable row level security;
alter table public.moto_media enable row level security;
alter table public.moto_requests enable row level security;
alter table public.moto_audit enable row level security;
alter table private.moto_request_limits enable row level security;
revoke all on public.moto_staff,public.moto_draft,public.moto_revisions,public.moto_live,public.moto_media,public.moto_requests,public.moto_audit from anon,authenticated;
grant all on public.moto_staff,public.moto_draft,public.moto_revisions,public.moto_live,public.moto_media,public.moto_requests,public.moto_audit to service_role;
grant usage,select on sequence public.moto_audit_id_seq to service_role;
grant select on public.moto_live to anon,authenticated;
create policy "Read current published website" on public.moto_live for select to anon,authenticated using(true);

create function private.moto_is_editor() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.moto_staff s join auth.users u on u.id=s.user_id
    where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','editor') and u.email_confirmed_at is not null);
$$;
revoke all on function private.moto_is_editor() from public;
grant usage on schema private to authenticated;
grant execute on function private.moto_is_editor() to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('moto-media','moto-media',false,5242880,array['image/png','image/jpeg','image/webp']),
 ('moto-public','moto-public',true,5242880,array['image/png','image/jpeg','image/webp']);
create policy "Staff upload own new pictures" on storage.objects for insert to authenticated
 with check(bucket_id='moto-media' and (storage.foldername(name))[1]=(select auth.uid())::text and private.moto_is_editor());
create policy "Staff view private pictures" on storage.objects for select to authenticated
 using(bucket_id='moto-media' and private.moto_is_editor());

-- Only the Edge Function's service credential may call mutation routines.
create function public.moto_save_draft(p_actor uuid,p_expected bigint,p_content jsonb,p_changes jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 if not exists(select 1 from public.moto_staff where user_id=p_actor and active and role in ('owner','editor')) then raise exception 'Not allowed'; end if;
 if jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>2000000 or jsonb_typeof(p_changes)<>'array' then raise exception 'Invalid document'; end if;
 select version into v from public.moto_draft where id=true for update;
 if v is distinct from p_expected then raise exception 'DRAFT_CONFLICT'; end if;
 update public.moto_draft set content=p_content,changes=p_changes,version=version+1,updated_at=now(),updated_by=p_actor where id=true returning version into v;
 insert into public.moto_audit(actor,action,details) values(p_actor,'draft_saved',jsonb_build_object('version',v));
 return v;
end;$$;

create function public.moto_publish(p_actor uuid,p_expected bigint,p_public_content jsonb,p_summary text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.moto_draft; revision_id uuid;
begin
 if not exists(select 1 from public.moto_staff where user_id=p_actor and active and (role='owner' or (role='editor' and can_publish))) then raise exception 'Publishing not allowed'; end if;
 select * into d from public.moto_draft where id=true for update;
 if d.version is distinct from p_expected then raise exception 'DRAFT_CONFLICT'; end if;
 if jsonb_typeof(p_public_content)<>'object' or octet_length(p_public_content::text)>2000000 then raise exception 'Invalid publication'; end if;
 insert into public.moto_revisions(content,public_content,summary,created_by) values(d.content,p_public_content,left(p_summary,500),p_actor) returning id into revision_id;
 insert into public.moto_live(id,revision,content,published_at) values(true,revision_id,p_public_content,now()) on conflict(id) do update set revision=excluded.revision,content=excluded.content,published_at=excluded.published_at;
 update public.moto_draft set changes='[]',version=version+1,updated_by=p_actor,updated_at=now() where id=true;
 insert into public.moto_audit(actor,action,details) values(p_actor,'published',jsonb_build_object('revision',revision_id));
 return jsonb_build_object('revision',revision_id,'draftVersion',d.version+1);
end;$$;

create function public.moto_restore(p_actor uuid,p_expected bigint,p_revision uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.moto_draft; previous public.moto_revisions; revision_id uuid;
begin
 if not exists(select 1 from public.moto_staff where user_id=p_actor and active and role='owner') then raise exception 'Only the owner can restore'; end if;
 select * into d from public.moto_draft where id=true for update;
 if d.version is distinct from p_expected then raise exception 'DRAFT_CONFLICT'; end if;
 select * into previous from public.moto_revisions where id=p_revision;
 if not found then raise exception 'Revision not found'; end if;
 insert into public.moto_revisions(content,public_content,summary,created_by) values(previous.content,previous.public_content,'Restored previous website version',p_actor) returning id into revision_id;
 update public.moto_live set revision=revision_id,content=previous.public_content,published_at=now() where id=true;
 update public.moto_draft set content=previous.content,changes='[]',version=version+1,updated_by=p_actor,updated_at=now() where id=true;
 insert into public.moto_audit(actor,action,details) values(p_actor,'restored',jsonb_build_object('from',p_revision,'revision',revision_id));
 return jsonb_build_object('revision',revision_id,'draftVersion',d.version+1);
end;$$;

create function public.moto_update_request(p_actor uuid,p_id uuid,p_expected bigint,p_status text,p_notes text)
returns bigint language plpgsql security definer set search_path='' as $$
declare r public.moto_requests;
begin
 if not exists(select 1 from public.moto_staff where user_id=p_actor and active) then raise exception 'Not allowed'; end if;
 if p_status not in ('new','contacted','confirmed','completed','cancelled') or length(p_notes)>3000 then raise exception 'Invalid request update'; end if;
 select * into r from public.moto_requests where id=p_id for update;
 if not found then raise exception 'Request not found'; end if;
 if r.version<>p_expected then raise exception 'REQUEST_CONFLICT'; end if;
 update public.moto_requests set status=p_status,staff_notes=p_notes,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id;
 insert into public.moto_audit(actor,action,details) values(p_actor,'request_updated',jsonb_build_object('request',p_id,'from',r.status,'to',p_status));
 return r.version+1;
end;$$;

create function public.moto_submit_request(p_key uuid,p_rate_key text,p_kind text,p_name text,p_phone text,p_details jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare result text; n integer; win timestamptz;
begin
 select receipt into result from public.moto_requests where idempotency_key=p_key;
 if found then return result; end if;
 insert into private.moto_request_limits(key) values(p_rate_key) on conflict(key) do nothing;
 select count,window_started into n,win from private.moto_request_limits where key=p_rate_key for update;
 if win<now()-interval '1 hour' then n:=0;win:=now();end if;
 if n>=10 then raise exception 'RATE_LIMIT'; end if;
 update private.moto_request_limits set count=n+1,window_started=win where key=p_rate_key;
 result:='MM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 insert into public.moto_requests(receipt,idempotency_key,kind,customer_name,phone,details) values(result,p_key,p_kind,p_name,p_phone,p_details);
 return result;
end;$$;

revoke all on function public.moto_save_draft(uuid,bigint,jsonb,jsonb),public.moto_publish(uuid,bigint,jsonb,text),public.moto_restore(uuid,bigint,uuid),public.moto_update_request(uuid,uuid,bigint,text,text),public.moto_submit_request(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.moto_save_draft(uuid,bigint,jsonb,jsonb),public.moto_publish(uuid,bigint,jsonb,text),public.moto_restore(uuid,bigint,uuid),public.moto_update_request(uuid,uuid,bigint,text,text),public.moto_submit_request(uuid,text,text,text,text,jsonb) to service_role;
