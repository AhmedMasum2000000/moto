-- Serialize retries before checking the receipt. A changed payload needs a fresh key.
create or replace function public.moto_submit_request(p_key uuid,p_rate_key text,p_kind text,p_name text,p_phone text,p_details jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare saved public.moto_requests; receipt_code text; n integer; win timestamptz; limit_key text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,0));
 select * into saved from public.moto_requests where idempotency_key=p_key;
 if found then
   if saved.kind<>p_kind or saved.customer_name<>p_name or saved.phone<>p_phone or saved.details<>p_details then raise exception 'REQUEST_CHANGED'; end if;
   return saved.receipt;
 end if;
 for limit_key in select k from unnest(array['ip:'||p_rate_key,'phone:'||md5(p_phone)]) as k order by k loop
   insert into private.moto_request_limits(key,count) values(limit_key,0) on conflict(key) do nothing;
   select count,window_started into n,win from private.moto_request_limits where key=limit_key for update;
   if win<now()-interval '1 hour' then n:=0;win:=now();end if;
   if n>=10 then raise exception 'RATE_LIMIT'; end if;
   update private.moto_request_limits set count=n+1,window_started=win where key=limit_key;
 end loop;
 receipt_code:='MM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 insert into public.moto_requests(receipt,idempotency_key,kind,customer_name,phone,details) values(receipt_code,p_key,p_kind,p_name,p_phone,p_details);
 return receipt_code;
end;$$;
