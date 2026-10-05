-- Run in the Supabase SQL editor. Only server-side service_role can access data.
create table if not exists public.replywise_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  business_type text not null,
  input text not null,
  output text not null,
  detected_language text not null,
  request_type text not null,
  follow_up_action text not null,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0)
);
create index if not exists replywise_visitor_idx on public.replywise_requests(visitor_id);
create table if not exists public.replywise_reservations (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists replywise_reservation_visitor_idx on public.replywise_reservations(visitor_id);
alter table public.replywise_requests enable row level security;
alter table public.replywise_reservations enable row level security;
revoke all on public.replywise_requests, public.replywise_reservations from anon, authenticated;
grant all on public.replywise_requests, public.replywise_reservations to service_role;

-- Serialize per visitor, count successful rows, and reserve capacity before Gemini.
create or replace function public.replywise_claim(p_visitor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare used_count integer; pending_count integer; reservation uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_visitor::text, 0));
  delete from replywise_reservations where visitor_id = p_visitor and created_at < now() - interval '2 minutes';
  select count(*) into used_count from replywise_requests where visitor_id = p_visitor;
  select count(*) into pending_count from replywise_reservations where visitor_id = p_visitor;
  if used_count >= 5 or pending_count > 0 then
    return jsonb_build_object('used', used_count, 'reservation_id', null);
  end if;
  insert into replywise_reservations(visitor_id) values(p_visitor) returning id into reservation;
  return jsonb_build_object('used', used_count, 'reservation_id', reservation);
end; $$;

create or replace function public.replywise_release(p_reservation uuid) returns jsonb
language sql security definer set search_path = public as $$
  with deleted as (delete from replywise_reservations where id = p_reservation returning id)
  select jsonb_build_object('released', count(*)) from deleted;
$$;

create or replace function public.replywise_complete(
 p_reservation uuid, p_business text, p_input text, p_output text,
 p_language text, p_type text, p_action text, p_input_tokens integer, p_output_tokens integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare visitor uuid; used_count integer;
begin
  select visitor_id into visitor from replywise_reservations where id = p_reservation;
  if visitor is null then raise exception 'Reservation unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(visitor::text, 0));
  perform 1 from replywise_reservations where id = p_reservation and created_at >= now() - interval '2 minutes' for update;
  if not found then raise exception 'Reservation expired'; end if;
  select count(*) into used_count from replywise_requests where visitor_id = visitor;
  if used_count >= 5 then raise exception 'Usage limit reached'; end if;
  insert into replywise_requests(visitor_id,business_type,input,output,detected_language,request_type,follow_up_action,input_tokens,output_tokens)
    values(visitor,p_business,p_input,p_output,p_language,p_type,p_action,p_input_tokens,p_output_tokens);
  delete from replywise_reservations where id = p_reservation;
  return jsonb_build_object('used', used_count + 1);
end; $$;

create or replace function public.replywise_stats(p_visitor uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shops_served', (select count(distinct visitor_id) from replywise_requests),
    'languages', (select count(distinct lower(trim(detected_language))) from replywise_requests),
    'most_common_request', (select request_type from replywise_requests group by request_type order by count(*) desc, request_type asc limit 1),
    'used', (select count(*) from replywise_requests where visitor_id = p_visitor)
  );
$$;
revoke all on function public.replywise_claim(uuid), public.replywise_release(uuid), public.replywise_complete(uuid,text,text,text,text,text,text,integer,integer), public.replywise_stats(uuid) from public, anon, authenticated;
grant execute on function public.replywise_claim(uuid), public.replywise_release(uuid), public.replywise_complete(uuid,text,text,text,text,text,text,integer,integer), public.replywise_stats(uuid) to service_role;
