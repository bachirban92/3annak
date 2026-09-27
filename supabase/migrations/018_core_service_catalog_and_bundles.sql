create table if not exists public.service_bundle_items (
  bundle_service_id uuid not null references public.services(id) on delete cascade,
  item_service_id uuid not null references public.services(id) on delete restrict,
  sort_order integer not null default 0,
  primary key(bundle_service_id,item_service_id),
  check(bundle_service_id<>item_service_id)
);

alter table public.service_bundle_items enable row level security;
drop policy if exists "bundle items read" on public.service_bundle_items;
create policy "bundle items read" on public.service_bundle_items for select to authenticated using(true);

create table if not exists public.order_deliverables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  service_name_ar text not null,
  source_service_id uuid references public.services(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(order_id,service_id)
);

alter table public.order_deliverables enable row level security;
drop policy if exists "order deliverables parties read" on public.order_deliverables;
create policy "order deliverables parties read" on public.order_deliverables
for select to authenticated using(private.can_access_order(order_id));

insert into public.service_bundle_items(bundle_service_id,item_service_id,sort_order)
select b.id,i.id,
       case i.code
         when 'property_certificate' then 10
         when 'cadastral_map' then 20
         when 'planning_easement' then 30
         when 'area_statement' then 40
         when 'ownership_statement' then 50
         else 100
       end
from public.services b
join public.services i on i.code in ('property_certificate','cadastral_map','planning_easement','area_statement','ownership_statement')
where b.code='full_file'
on conflict(bundle_service_id,item_service_id) do update set sort_order=excluded.sort_order;

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
  end if;

  insert into public.order_events(order_id,status,label_ar,created_by)
  values(v_order_id,'submitted',public.order_status_label_ar('submitted'),auth.uid());

  perform public.try_dispatch_order(v_order_id);

  return query
  select o.id,o.public_code,o.total_amount from public.orders o where o.id=v_order_id;
end;
$$;

revoke execute on function public.create_order(text,text,text,text,text,text,text,text,text,text[]) from public,anon;
grant execute on function public.create_order(text,text,text,text,text,text,text,text,text,text[]) to authenticated;
