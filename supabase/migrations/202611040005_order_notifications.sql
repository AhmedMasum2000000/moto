-- Records when the store was emailed about an order, so a double submit sends one email
-- and a failed email can be sent again on retry. Earlier requests count as already notified.
alter table public.moto_requests add column if not exists notified_at timestamptz;
update public.moto_requests set notified_at = created_at where notified_at is null;
