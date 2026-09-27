create or replace function public.admin_replace_bundle_items(
  p_bundle_service_id uuid,
  p_item_service_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  if not exists(
    select 1 from public.services
    where id=p_bundle_service_id and service_type='bundle'
  ) then raise exception 'bundle_not_found'; end if;

  if coalesce(array_length(p_item_service_ids,1),0)=0 then
    raise exception 'bundle_requires_item';
  end if;

  if exists(
    select 1
    from unnest(p_item_service_ids) x(id)
    left join public.services s on s.id=x.id
    where s.id is null or s.service_type<>'document' or s.id=p_bundle_service_id
  ) then raise exception 'invalid_bundle_item'; end if;

  if (select count(*) from unnest(p_item_service_ids)) <>
     (select count(distinct x) from unnest(p_item_service_ids) x)
  then raise exception 'duplicate_bundle_item'; end if;

  delete from public.service_bundle_items
  where bundle_service_id=p_bundle_service_id;

  insert into public.service_bundle_items(bundle_service_id,item_service_id,sort_order)
  select p_bundle_service_id,x.id,row_number() over(order by s.sort_order,s.name_ar)::integer*10
  from unnest(p_item_service_ids) x(id)
  join public.services s on s.id=x.id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),'bundle_items_updated','service',p_bundle_service_id::text,
    jsonb_build_object('item_service_ids',to_jsonb(p_item_service_ids))
  );
end;
$$;

create or replace function public.create_order(
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_governorate text,
  p_district text,
  p_cadastral_area text,
  p_property_number text,
  p_property_section text,
  p_notes text,
  p_service_codes text[]
)
returns table(order_id uuid,public_code text,total_amount numeric)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_services_total numeric(10,2);
  v_official_fees numeric(10,2);
  v_bundle_id uuid;
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

  select s.id into v_bundle_id
  from public.services s
  where s.code=any(p_service_codes) and s.service_type='bundle'
  limit 1;

  if v_bundle_id is not null and coalesce(array_length(p_service_codes,1),0)>1 then
    raise exception 'bundle_must_be_selected_alone';
  end if;

  if v_bundle_id is not null and not exists(
    select 1 from public.service_bundle_items where bundle_service_id=v_bundle_id
  ) then raise exception 'bundle_empty'; end if;

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
  from public.services s
  where s.code=any(p_service_codes) and s.active=true;

  if v_bundle_id is not null then
    insert into public.order_deliverables(order_id,service_id,service_name_ar,source_service_id,sort_order)
    select v_order_id,i.id,i.name_ar,v_bundle_id,b.sort_order
    from public.service_bundle_items b
    join public.services i on i.id=b.item_service_id
    where b.bundle_service_id=v_bundle_id
    order by b.sort_order;

    insert into public.order_requirements(order_id,requirement_id,code,label_ar,requirement_type,required)
    select distinct on (q.code)
      v_order_id,q.id,q.code,q.label_ar,q.requirement_type,q.required
    from (
      select sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required,sr.sort_order
      from public.service_requirements sr
      where sr.service_id=v_bundle_id and sr.active=true
      union all
      select sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required,sr.sort_order
      from public.service_bundle_items b
      join public.service_requirements sr on sr.service_id=b.item_service_id
      where b.bundle_service_id=v_bundle_id and sr.active=true
    ) q
    order by q.code,q.sort_order;

    insert into public.order_workflow_steps(order_id,status,label_ar,sort_order)
    select distinct on (q.status)
      v_order_id,q.status,q.label_ar,q.sort_order
    from (
      select sw.status,sw.label_ar,sw.sort_order
      from public.service_workflow_steps sw
      where sw.service_id=v_bundle_id and sw.active=true
      union all
      select sw.status,sw.label_ar,sw.sort_order
      from public.service_bundle_items b
      join public.service_workflow_steps sw on sw.service_id=b.item_service_id
      where b.bundle_service_id=v_bundle_id and sw.active=true
    ) q
    order by q.status,q.sort_order;
  else
    insert into public.order_deliverables(order_id,service_id,service_name_ar,source_service_id,sort_order)
    select v_order_id,s.id,s.name_ar,s.id,s.sort_order
    from public.services s
    where s.code=any(p_service_codes) and s.active=true
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

  return query
  select o.id,o.public_code,o.total_amount
  from public.orders o where o.id=v_order_id;
end;
$$;

revoke execute on function public.admin_replace_bundle_items(uuid,uuid[]) from public,anon;
grant execute on function public.admin_replace_bundle_items(uuid,uuid[]) to authenticated;
