-- Run AFTER schema.sql. All WhatsApp data and functions are server-only.
create table if not exists public.replywise_whatsapp_account (
  id integer primary key default 1 check (id = 1),
  connected boolean not null default false,
  phone_id text,
  label text,
  business_type text,
  visitor_id uuid not null default gen_random_uuid(),
  connected_at timestamptz
);
insert into public.replywise_whatsapp_account(id) values(1) on conflict do nothing;
create table if not exists public.replywise_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  meta_message_id text not null unique,
  received_at timestamptz not null,
  recipient_encrypted text not null,
  message text not null,
  too_long boolean not null default false,
  state text not null default 'new' check (state in ('new','draft','sending','sent','send_failed','send_unknown')),
  draft jsonb,
  sent_reply text,
  outgoing_meta_id text,
  send_started_at timestamptz
);
create table if not exists public.replywise_whatsapp_login_gate (
  id integer primary key check(id=1),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
insert into public.replywise_whatsapp_login_gate(id) values(1) on conflict do nothing;
alter table public.replywise_whatsapp_account enable row level security;
alter table public.replywise_whatsapp_messages enable row level security;
alter table public.replywise_whatsapp_login_gate enable row level security;
revoke all on public.replywise_whatsapp_account, public.replywise_whatsapp_messages, public.replywise_whatsapp_login_gate from anon, authenticated;
grant all on public.replywise_whatsapp_account, public.replywise_whatsapp_messages, public.replywise_whatsapp_login_gate to service_role;

create or replace function public.replywise_wa_login_gate() returns boolean language plpgsql security definer set search_path=public as $$
declare gate replywise_whatsapp_login_gate%rowtype;
begin
  select * into gate from replywise_whatsapp_login_gate where id=1 for update;
  if gate.window_started_at < now()-interval '15 minutes' then
    update replywise_whatsapp_login_gate set window_started_at=now(),attempts=1 where id=1;
    return true;
  end if;
  if gate.attempts >= 10 then return false; end if;
  update replywise_whatsapp_login_gate set attempts=attempts+1 where id=1;
  return true;
end; $$;

create or replace function public.replywise_wa_status() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('connected',a.connected,'label',a.label,'phone_id',a.phone_id,'business_type',a.business_type,'visitor_id',a.visitor_id,'used',(select count(*) from replywise_requests where visitor_id=a.visitor_id)) from replywise_whatsapp_account a where id=1;
$$;
create or replace function public.replywise_wa_connect(p_phone_id text,p_label text,p_business text) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing replywise_whatsapp_account%rowtype;
begin
  select * into existing from replywise_whatsapp_account where id=1 for update;
  if existing.phone_id is distinct from p_phone_id then delete from replywise_whatsapp_messages; end if;
  update replywise_whatsapp_account set connected=true,phone_id=p_phone_id,label=p_label,business_type=p_business,connected_at=now() where id=1;
  return jsonb_build_object('connected',true);
end; $$;
create or replace function public.replywise_wa_disconnect() returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update replywise_whatsapp_account set connected=false,phone_id=null,label=null,business_type=null where id=1;
  delete from replywise_whatsapp_messages;
  return jsonb_build_object('connected',false);
end; $$;

create or replace function public.replywise_wa_receive(p_phone_id text,p_meta_id text,p_received_at timestamptz,p_recipient text,p_message text,p_too_long boolean) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform 1 from replywise_whatsapp_account where id=1 and connected and phone_id=p_phone_id for share;
  if not found then return false; end if;
  if p_received_at < now()-interval '7 days' or p_received_at > now()+interval '5 minutes' then return false; end if;
  delete from replywise_whatsapp_messages where received_at < now()-interval '7 days';
  insert into replywise_whatsapp_messages(meta_message_id,received_at,recipient_encrypted,message,too_long)
    values(p_meta_id,p_received_at,p_recipient,p_message,p_too_long) on conflict(meta_message_id) do nothing;
  return true;
end; $$;
create or replace function public.replywise_wa_inbox() returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  delete from replywise_whatsapp_messages where received_at < now()-interval '7 days';
  -- A crashed send must not become retryable: Meta may have accepted it.
  update replywise_whatsapp_messages set state='send_unknown' where state='sending' and send_started_at < now()-interval '2 minutes';
  select coalesce(jsonb_agg(row_to_json(m)),'[]'::jsonb) into result from (
    select id,received_at,message,too_long,state,draft,sent_reply,(received_at > now()-interval '24 hours') as can_reply
    from replywise_whatsapp_messages order by received_at desc limit 20
  ) m;
  return result;
end; $$;
create or replace function public.replywise_wa_message(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('id',id,'message',message,'too_long',too_long,'state',state,'draft',draft,'can_reply',received_at > now()-interval '24 hours') from replywise_whatsapp_messages where id=p_id;
$$;

create or replace function public.replywise_wa_complete(p_id uuid,p_reservation uuid,p_business text,p_input text,p_output text,p_language text,p_type text,p_action text,p_input_tokens integer,p_output_tokens integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved jsonb; visitor uuid; record replywise_whatsapp_messages%rowtype;
begin
  select visitor_id into visitor from replywise_whatsapp_account where id=1 and connected for share;
  if visitor is null then raise exception 'Account disconnected'; end if;
  perform 1 from replywise_reservations where id=p_reservation and visitor_id=visitor;
  if not found then raise exception 'Wrong reservation'; end if;
  select * into record from replywise_whatsapp_messages where id=p_id for update;
  if not found or record.state <> 'new' or record.too_long or record.received_at <= now()-interval '24 hours' then raise exception 'Message unavailable'; end if;
  saved := replywise_complete(p_reservation,p_business,p_input,p_output,p_language,p_type,p_action,p_input_tokens,p_output_tokens);
  update replywise_whatsapp_messages set state='draft',draft=jsonb_build_object('detected_language',p_language,'request_type',p_type,'reply',p_output,'follow_up_action',p_action) where id=p_id;
  return saved;
end; $$;
create or replace function public.replywise_wa_claim_send(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare record replywise_whatsapp_messages%rowtype;
begin
  perform 1 from replywise_whatsapp_account where id=1 and connected for share;
  if not found then return null; end if;
  select * into record from replywise_whatsapp_messages where id=p_id for update;
  if not found or record.state not in ('draft','send_failed') or record.draft is null or record.received_at <= now()-interval '24 hours' then return null; end if;
  update replywise_whatsapp_messages set state='sending',send_started_at=now() where id=p_id;
  return jsonb_build_object('recipient_encrypted',record.recipient_encrypted);
end; $$;
create or replace function public.replywise_wa_finish_send(p_id uuid,p_state text,p_meta_id text,p_reply text) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_state not in ('sent','send_failed','send_unknown') then raise exception 'Invalid send state'; end if;
  update replywise_whatsapp_messages set state=p_state,outgoing_meta_id=p_meta_id,sent_reply=p_reply where id=p_id and state in ('sending','send_unknown');
  return found;
end; $$;

revoke all on function public.replywise_wa_login_gate(),public.replywise_wa_status(),public.replywise_wa_connect(text,text,text),public.replywise_wa_disconnect(),public.replywise_wa_receive(text,text,timestamptz,text,text,boolean),public.replywise_wa_inbox(),public.replywise_wa_message(uuid),public.replywise_wa_complete(uuid,uuid,text,text,text,text,text,text,integer,integer),public.replywise_wa_claim_send(uuid),public.replywise_wa_finish_send(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.replywise_wa_login_gate(),public.replywise_wa_status(),public.replywise_wa_connect(text,text,text),public.replywise_wa_disconnect(),public.replywise_wa_receive(text,text,timestamptz,text,text,boolean),public.replywise_wa_inbox(),public.replywise_wa_message(uuid),public.replywise_wa_complete(uuid,uuid,text,text,text,text,text,text,integer,integer),public.replywise_wa_claim_send(uuid),public.replywise_wa_finish_send(uuid,text,text,text) to service_role;
