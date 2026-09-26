alter table public.services
  add column if not exists official_fee numeric(10,2) not null default 0 check (official_fee >= 0);

create table if not exists public.service_requirements (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  code text not null,
  label_ar text not null,
  requirement_type text not null default 'file' check (requirement_type in ('file','text')),
  required boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_id, code)
);

create table if not exists public.order_requirements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  requirement_id uuid references public.service_requirements(id) on delete set null,
  code text not null,
  label_ar text not null,
  requirement_type text not null check (requirement_type in ('file','text')),
  required boolean not null default true,
  value_text text,
  document_id uuid references public.documents(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id, code)
);

drop trigger if exists service_requirements_set_updated_at on public.service_requirements;
create trigger service_requirements_set_updated_at
before update on public.service_requirements
for each row execute function public.set_updated_at();

alter table public.service_requirements enable row level security;
alter table public.order_requirements enable row level security;

create policy "service requirements public read"
on public.service_requirements for select to anon,authenticated
using (active = true or private.is_admin());

create policy "order requirements customer read"
on public.order_requirements for select to authenticated
using (
  exists(
    select 1 from public.orders o
    where o.id=order_id
      and (o.customer_id=(select auth.uid()) or o.assigned_agent_id=(select auth.uid()) or private.is_admin())
  )
);

create index if not exists idx_service_requirements_service on public.service_requirements(service_id,sort_order);
create index if not exists idx_order_requirements_order on public.order_requirements(order_id,required,completed_at);

create or replace function public.try_dispatch_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders;
  v_count integer := 0;
begin
  select * into v_order
  from public.orders
  where id=p_order_id and status='submitted' and assigned_agent_id is null;

  if v_order.id is null then return 0; end if;

  if exists(
    select 1 from public.order_requirements r
    where r.order_id=p_order_id and r.required=true and r.completed_at is null
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select v_order.id,ap.user_id,'available'
  from public.agent_profiles ap
  where ap.verification_status='approved'
    and ap.available=true
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(v_order.governorate))
    )
  on conflict(order_id,agent_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.complete_order_requirement(
  p_order_requirement_id uuid,
  p_value_text text default null,
  p_document_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_type text;
begin
  select r.order_id,r.requirement_type into v_order_id,v_type
  from public.order_requirements r
  join public.orders o on o.id=r.order_id
  where r.id=p_order_requirement_id and o.customer_id=auth.uid();

  if v_order_id is null then raise exception 'requirement_not_found'; end if;
  if v_type='file' and p_document_id is null then raise exception 'document_required'; end if;
  if v_type='text' and nullif(trim(p_value_text),'') is null then raise exception 'value_required'; end if;

  update public.order_requirements
  set value_text=nullif(trim(p_value_text),''),
      document_id=p_document_id,
      completed_at=now()
  where id=p_order_requirement_id;

  perform public.try_dispatch_order(v_order_id);
end;
$$;

create or replace function public.admin_upsert_service_requirement(
  p_service_id uuid,
  p_code text,
  p_label_ar text,
  p_requirement_type text,
  p_required boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  insert into public.service_requirements(service_id,code,label_ar,requirement_type,required,active)
  values(p_service_id,trim(p_code),trim(p_label_ar),p_requirement_type,p_required,true)
  on conflict(service_id,code) do update
    set label_ar=excluded.label_ar,requirement_type=excluded.requirement_type,required=excluded.required,active=true
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.try_dispatch_order(uuid) from public,anon;
revoke execute on function public.complete_order_requirement(uuid,text,uuid) from public,anon;
revoke execute on function public.admin_upsert_service_requirement(uuid,text,text,text,boolean) from public,anon;
grant execute on function public.try_dispatch_order(uuid) to authenticated;
grant execute on function public.complete_order_requirement(uuid,text,uuid) to authenticated;
grant execute on function public.admin_upsert_service_requirement(uuid,text,text,text,boolean) to authenticated;
grant select on public.service_requirements to anon,authenticated;
grant select on public.order_requirements to authenticated;
