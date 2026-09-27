create table if not exists public.service_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  status public.order_status not null,
  label_ar text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(service_id,status),
  check(status in ('in_progress','submitted_to_authority','processing','ready_for_collection','collected'))
);

create table if not exists public.order_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  label_ar text not null,
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,status),
  check(status in ('in_progress','submitted_to_authority','processing','ready_for_collection','collected'))
);

alter table public.service_workflow_steps enable row level security;
alter table public.order_workflow_steps enable row level security;

drop policy if exists "workflow service read" on public.service_workflow_steps;
create policy "workflow service read" on public.service_workflow_steps for select to authenticated using(true);

drop policy if exists "workflow order parties read" on public.order_workflow_steps;
create policy "workflow order parties read" on public.order_workflow_steps for select to authenticated using(private.can_access_order(order_id));

insert into public.service_workflow_steps(service_id,status,label_ar,sort_order,active)
select s.id,v.status,v.label_ar,v.sort_order,true
from public.services s
cross join (values
  ('in_progress'::public.order_status,'بدء العمل',10),
  ('submitted_to_authority'::public.order_status,'تم تقديم المعاملة',20),
  ('processing'::public.order_status,'قيد المعالجة',30),
  ('ready_for_collection'::public.order_status,'جاهز للاستلام',40),
  ('collected'::public.order_status,'تم استلام المستند',50)
) as v(status,label_ar,sort_order)
on conflict(service_id,status) do nothing;

create or replace function public.admin_set_service_workflow_step(
  p_service_id uuid,p_status public.order_status,p_active boolean,p_label_ar text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare v_sort integer;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('in_progress','submitted_to_authority','processing','ready_for_collection','collected')
    then raise exception 'invalid_workflow_status'; end if;

  v_sort:=case p_status
    when 'in_progress' then 10
    when 'submitted_to_authority' then 20
    when 'processing' then 30
    when 'ready_for_collection' then 40
    when 'collected' then 50
    else 100 end;

  insert into public.service_workflow_steps(service_id,status,label_ar,sort_order,active)
  values(
    p_service_id,p_status,
    coalesce(nullif(trim(p_label_ar),''),
      case p_status
        when 'in_progress' then 'بدء العمل'
        when 'submitted_to_authority' then 'تم تقديم المعاملة'
        when 'processing' then 'قيد المعالجة'
        when 'ready_for_collection' then 'جاهز للاستلام'
        when 'collected' then 'تم استلام المستند'
      end
    ),
    v_sort,p_active
  )
  on conflict(service_id,status) do update
  set active=excluded.active,
      label_ar=coalesce(nullif(trim(p_label_ar),''),public.service_workflow_steps.label_ar),
      sort_order=excluded.sort_order;
end;
$$;

create or replace function public.create_order(
  p_customer_name text,p_customer_phone text,p_customer_email text,p_governorate text,p_district text,
  p_cadastral_area text,p_property_number text,p_property_section text,p_notes text,p_service_codes text[]
)
returns table(order_id uuid,public_code text,total_amount numeric)
language plpgsql security definer set search_path='' as $$
declare
  v_order_id uuid;
  v_services_total numeric(10,2);
  v_official_fees numeric(10,2);
  v_full_file boolean;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce(array_length(p_service_codes,1),0)=0 then raise exception 'service_required'; end if;

  if exists(
    select 1 from unnest(p_service_codes)c
    where not exists(select 1 from public.services s where s.code=c and s.active=true)
  ) then raise exception 'invalid_service'; end if;

  if (select count(*) from unnest(p_service_codes)c) <>
     (select count(distinct c) from unnest(p_service_codes)c)
  then raise exception 'duplicate_service'; end if;

  v_full_file := 'full_file'=any(p_service_codes);
  if v_full_file and coalesce(array_length(p_service_codes,1),0)>1 then
    raise exception 'bundle_must_be_selected_alone';
  end if;

  select coalesce(sum(s.customer_price),0),coalesce(sum(s.official_fee),0)
  into v_services_total,v_official_fees
  from public.services s
  where s.code=any(p_service_codes) and s.active=true;

  insert into public.orders(
    customer_id,customer_name,customer_phone,customer_email,
    governorate,district,cadastral_area,property_number,property_section,notes,
    services_total,official_fees,total_amount
  )
  values(
    auth.uid(),nullif(trim(p_customer_name),''),trim(p_customer_phone),nullif(trim(p_customer_email),''),
    trim(p_governorate),nullif(trim(p_district),''),trim(p_cadastral_area),trim(p_property_number),
    nullif(trim(p_property_section),''),nullif(trim(p_notes),''),
    v_services_total,v_official_fees,v_services_total+v_official_fees
  )
  returning id into v_order_id;

  insert into public.order_items(order_id,service_id,service_name_ar,customer_price,agent_payout)
  select v_order_id,s.id,s.name_ar,s.customer_price,s.agent_payout
  from public.services s where s.code=any(p_service_codes) and s.active=true;

  if v_full_file then
    insert into public.order_deliverables(order_id,service_id,service_name_ar,source_service_id,sort_order)
    select v_order_id,i.id,i.name_ar,b.bundle_service_id,b.sort_order
    from public.service_bundle_items b
    join public.services i on i.id=b.item_service_id
    join public.services bs on bs.id=b.bundle_service_id
    where bs.code='full_file'
    order by b.sort_order;

    insert into public.order_requirements(order_id,requirement_id,code,label_ar,requirement_type,required)
    select distinct on (sr.code)
      v_order_id,sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required
    from public.service_bundle_items b
    join public.services bs on bs.id=b.bundle_service_id
    join public.service_requirements sr on sr.service_id=b.item_service_id
    where bs.code='full_file' and sr.active=true
    order by sr.code,sr.sort_order;

    insert into public.order_workflow_steps(order_id,status,label_ar,sort_order)
    select distinct on (sw.status)
      v_order_id,sw.status,sw.label_ar,sw.sort_order
    from public.service_bundle_items b
    join public.services bs on bs.id=b.bundle_service_id
    join public.service_workflow_steps sw on sw.service_id=b.item_service_id
    where bs.code='full_file' and sw.active=true
    order by sw.status,sw.sort_order;
  else
    insert into public.order_deliverables(order_id,service_id,service_name_ar,source_service_id,sort_order)
    select v_order_id,s.id,s.name_ar,s.id,s.sort_order
    from public.services s where s.code=any(p_service_codes) and s.active=true
    order by s.sort_order;

    insert into public.order_requirements(order_id,requirement_id,code,label_ar,requirement_type,required)
    select distinct on (sr.code)
      v_order_id,sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required
    from public.service_requirements sr
    join public.services s on s.id=sr.service_id
    where s.code=any(p_service_codes) and sr.active=true
    order by sr.code,sr.sort_order;

    insert into public.order_workflow_steps(order_id,status,label_ar,sort_order)
    select distinct on (sw.status)
      v_order_id,sw.status,sw.label_ar,sw.sort_order
    from public.service_workflow_steps sw
    join public.services s on s.id=sw.service_id
    where s.code=any(p_service_codes) and sw.active=true
    order by sw.status,sw.sort_order;
  end if;

  insert into public.order_events(order_id,status,label_ar,created_by)
  values(v_order_id,'submitted',public.order_status_label_ar('submitted'),auth.uid());

  perform public.try_dispatch_order(v_order_id);

  return query select o.id,o.public_code,o.total_amount from public.orders o where o.id=v_order_id;
end;
$$;

insert into public.order_workflow_steps(order_id,status,label_ar,sort_order,completed_at)
select
  o.id,sw.status,sw.label_ar,sw.sort_order,
  case
    when o.status in ('completed','cancelled') then coalesce(o.completed_at,o.cancelled_at,now())
    when sw.sort_order <= case o.status
      when 'in_progress' then 10
      when 'submitted_to_authority' then 20
      when 'processing' then 30
      when 'ready_for_collection' then 40
      when 'collected' then 50
      else 0 end
    then now()
    else null
  end
from public.orders o
join public.order_items oi on oi.order_id=o.id
join public.service_workflow_steps sw on sw.service_id=oi.service_id and sw.active=true
on conflict(order_id,status) do nothing;

create or replace function public.update_order_status(
  p_order_id uuid,p_status public.order_status,p_note text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_current public.order_status;
  v_agent uuid;
  v_next public.order_workflow_steps;
  v_label text;
begin
  select status,assigned_agent_id into v_current,v_agent
  from public.orders where id=p_order_id for update;

  if v_current is null then raise exception 'order_not_found'; end if;
  if not public.is_admin() and v_agent <> auth.uid() then raise exception 'not_authorized'; end if;

  if not public.is_admin() then
    if p_status='cancelled' then
      if v_current in ('completed','cancelled','submitted') then raise exception 'invalid_status_transition'; end if;
    elsif p_status='completed' then
      if exists(select 1 from public.order_workflow_steps where order_id=p_order_id and completed_at is null)
        then raise exception 'workflow_incomplete'; end if;

      if exists(
        select 1 from public.order_deliverables od
        where od.order_id=p_order_id
          and not exists(
            select 1 from public.documents d
            where d.deliverable_id=od.id and d.order_id=p_order_id and d.kind='final_document'
          )
      ) then raise exception 'deliverables_incomplete'; end if;
    else
      select * into v_next
      from public.order_workflow_steps
      where order_id=p_order_id and completed_at is null
      order by sort_order,id
      limit 1;

      if v_next.id is null or v_next.status<>p_status then raise exception 'invalid_status_transition'; end if;
    end if;
  end if;

  if p_status not in ('completed','cancelled') then
    update public.order_workflow_steps
    set completed_at=coalesce(completed_at,now())
    where order_id=p_order_id and status=p_status;
  end if;

  select label_ar into v_label
  from public.order_workflow_steps
  where order_id=p_order_id and status=p_status limit 1;

  update public.orders
  set status=p_status,
      completed_at=case when p_status='completed' then now() else completed_at end,
      cancelled_at=case when p_status='cancelled' then now() else cancelled_at end
  where id=p_order_id;

  insert into public.order_events(order_id,status,label_ar,note,created_by)
  values(p_order_id,p_status,coalesce(v_label,public.order_status_label_ar(p_status)),nullif(trim(p_note),''),auth.uid());

  if p_status='completed' and v_agent is not null then
    update public.agent_ledger
    set status='available',available_at=now()
    where order_id=p_order_id and agent_id=v_agent and entry_type='job_earning' and status='pending';

    update public.agent_profiles
    set completed_orders=completed_orders+1
    where user_id=v_agent;
  end if;
end;
$$;

revoke execute on function public.admin_set_service_workflow_step(uuid,public.order_status,boolean,text) from public,anon;
grant execute on function public.admin_set_service_workflow_step(uuid,public.order_status,boolean,text) to authenticated;

create index if not exists idx_service_workflow_steps_service
on public.service_workflow_steps(service_id,active,sort_order);

create index if not exists idx_order_workflow_steps_order
on public.order_workflow_steps(order_id,completed_at,sort_order);
