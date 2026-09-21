-- Run once in the Supabase SQL editor. No browser has access to these tables.
begin;
create table if not exists public.leads (
 id uuid primary key,
 created_at timestamptz not null default now(),
 name text not null, email text not null, company text not null default '',
 role text not null, project_type text not null, challenge text not null,
 tools text not null default '', frequency text not null, budget text not null,
 timeline text not null, consent boolean not null check(consent),
 consent_version text not null, score integer not null check(score between 0 and 100),
 route text not null, qualification_reason text not null,
 status text not null default 'new', payload_hash text not null
);
create table if not exists public.lead_deliveries (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 kind text not null check(kind in ('acknowledgment','notification','webhook')),
 status text not null default 'pending' check(status in ('pending','sending','sent','needs_review')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 locked_until timestamptz, claim_token uuid, sent_at timestamptz, last_error text,
 unique(lead_id,kind)
);
create index if not exists lead_delivery_queue on public.lead_deliveries(status,next_attempt_at);
create table if not exists public.intake_limits (
 key text primary key, window_start timestamptz not null, count integer not null
);
alter table public.leads enable row level security;
alter table public.lead_deliveries enable row level security;
alter table public.intake_limits enable row level security;
revoke all on public.leads, public.lead_deliveries, public.intake_limits from anon, authenticated;
grant select,insert,update,delete on public.leads, public.lead_deliveries, public.intake_limits to service_role;

create or replace function public.submit_lead(p_record jsonb,p_payload_hash text,p_ip_hash text,p_email_hash text,p_webhook boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare lead_id uuid := (p_record->>'id')::uuid; old_hash text; ip_count integer; email_count integer;
begin
 -- Serialize retries of one submission before checking for the existing record.
 perform pg_advisory_xact_lock(hashtextextended(lead_id::text,0));
 select payload_hash into old_hash from public.leads where id=lead_id;
 if found then
  if old_hash<>p_payload_hash then raise exception 'ID_CONFLICT'; end if;
  return lead_id;
 end if;
 -- Atomic shared rate limits work across stateless function instances.
 insert into public.intake_limits as limits(key,window_start,count) values('ip:'||p_ip_hash,date_trunc('hour',now()),1)
 on conflict(key) do update set window_start=excluded.window_start,
 count=case when limits.window_start=excluded.window_start then limits.count+1 else 1 end returning count into ip_count;
 insert into public.intake_limits as limits(key,window_start,count) values('email:'||p_email_hash,date_trunc('day',now()),1)
 on conflict(key) do update set window_start=excluded.window_start,
 count=case when limits.window_start=excluded.window_start then limits.count+1 else 1 end returning count into email_count;
 if ip_count>5 or email_count>3 then raise exception 'RATE_LIMIT'; end if;
 insert into public.leads(id,name,email,company,role,project_type,challenge,tools,frequency,budget,timeline,consent,consent_version,score,route,qualification_reason,payload_hash)
 values(lead_id,p_record->>'name',p_record->>'email',p_record->>'company',p_record->>'role',p_record->>'project_type',p_record->>'challenge',p_record->>'tools',p_record->>'frequency',p_record->>'budget',p_record->>'timeline',(p_record->>'consent')::boolean,p_record->>'consent_version',(p_record->>'score')::integer,p_record->>'route',p_record->>'qualification_reason',p_payload_hash);
 insert into public.lead_deliveries(lead_id,kind) values(lead_id,'acknowledgment'),(lead_id,'notification');
 if p_webhook then insert into public.lead_deliveries(lead_id,kind) values(lead_id,'webhook'); end if;
 return lead_id;
end $$;

create or replace function public.claim_deliveries(p_lead_id uuid default null,p_limit integer default 10)
returns table(id uuid,kind text,attempts integer,claim_token uuid,lead jsonb)
language sql security definer set search_path=public,pg_temp as $$
 with candidates as (
  select d.id from public.lead_deliveries d
  where ((d.status='pending' and d.next_attempt_at<=now()) or (d.status='sending' and d.locked_until<now()))
   and (p_lead_id is null or d.lead_id=p_lead_id)
  order by d.next_attempt_at for update skip locked limit greatest(1,least(p_limit,10))
 ), claimed as (
  update public.lead_deliveries d set status='sending',attempts=d.attempts+1,
   locked_until=now()+interval '90 seconds',claim_token=gen_random_uuid()
  from candidates c where d.id=c.id returning d.*
 )
 select c.id,c.kind,c.attempts,c.claim_token,to_jsonb(l)-'payload_hash'
 from claimed c join public.leads l on l.id=c.lead_id;
$$;

create or replace function public.clean_intake_limits() returns void
language sql security definer set search_path=public,pg_temp as $$
 delete from public.intake_limits where window_start<now()-interval '2 days';
$$;

revoke all on function public.submit_lead(jsonb,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_deliveries(uuid,integer) from public,anon,authenticated;
revoke all on function public.clean_intake_limits() from public,anon,authenticated;
grant execute on function public.submit_lead(jsonb,text,text,text,boolean) to service_role;
grant execute on function public.claim_deliveries(uuid,integer) to service_role;
grant execute on function public.clean_intake_limits() to service_role;
commit;
