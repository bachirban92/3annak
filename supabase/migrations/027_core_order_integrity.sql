-- Core order integrity hardening.
-- Prevent premature dispatch, validate core inputs, merge duplicated requirements safely,
-- and keep cancellation semantics on the dedicated cancellation path.

drop trigger if exists trg_dispatch_new_order on public.orders;

delete from public.dispatch_offers d
using public.orders o
where d.order_id=o.id
  and d.status='available'
  and (
    exists (
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    or (
      private.payments_enforced()
      and o.total_amount>0
      and not exists (
        select 1 from public.payments p where p.order_id=o.id and p.status='paid'
      )
    )
  );

delete from public.notifications n
using public.orders o
where n.order_id=o.id
  and n.title='طلب جديد'
  and (
    exists (
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    or (
      private.payments_enforced()
      and o.total_amount>0
      and not exists (
        select 1 from public.payments p where p.order_id=o.id and p.status='paid'
      )
    )
  );

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
returns table(order_id uuid, public_code text, total_amount numeric)
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_order_id uuid;
  v_services_total numeric(10,2);
  v_official_fees numeric(10,2);
  v_bundle_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'customer_login_required';
  end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role='customer'
  ) then raise exception 'customer_account_required'; end if;

  if nullif(trim(p_customer_name),'') is null then raise exception 'customer_name_required'; end if;
  if nullif(trim(p_customer_phone),'') is null then raise exception 'customer_phone_required'; end if;
  if nullif(trim(p_governorate),'') is null then raise exception 'governorate_required'; end if;
  if nullif(trim(p_cadastral_area),'') is null then raise exception 'cadastral_area_required'; end if;
  if nullif(trim(p_property_number),'') is null then raise exception 'property_number_required'; end if;

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
    auth.uid(),trim(p_customer_name),trim(p_customer_phone),nullif(trim(p_customer_email),''),
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
    with q as (
      select sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required,sr.sort_order
      from public.service_requirements sr
      where sr.service_id=v_bundle_id and sr.active=true
      union all
      select sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required,sr.sort_order
      from public.service_bundle_items b
      join public.service_requirements sr on sr.service_id=b.item_service_id
      where b.bundle_service_id=v_bundle_id and sr.active=true
    ), a as (
      select
        code,
        (array_agg(id order by sort_order,id))[1] as requirement_id,
        (array_agg(label_ar order by sort_order,id))[1] as label_ar,
        (array_agg(requirement_type order by sort_order,id))[1] as requirement_type,
        bool_or(required) as required
      from q group by code
    )
    select v_order_id,requirement_id,code,label_ar,requirement_type,required
    from a;

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
    with q as (
      select sr.id,sr.code,sr.label_ar,sr.requirement_type,sr.required,sr.sort_order
      from public.service_requirements sr
      join public.services s on s.id=sr.service_id
      where s.code=any(p_service_codes) and sr.active=true
    ), a as (
      select
        code,
        (array_agg(id order by sort_order,id))[1] as requirement_id,
        (array_agg(label_ar order by sort_order,id))[1] as label_ar,
        (array_agg(requirement_type order by sort_order,id))[1] as requirement_type,
        bool_or(required) as required
      from q group by code
    )
    select v_order_id,requirement_id,code,label_ar,requirement_type,required
    from a;

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
$function$;

create or replace function public.admin_cancel_order(p_order_id uuid,p_reason text default null)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare v_paid boolean;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select exists(
    select 1 from public.payments p
    where p.order_id=p_order_id and p.status='paid'
  ) into v_paid;

  update public.orders
  set status='cancelled',
      cancelled_at=now(),
      refund_pending=v_paid
  where id=p_order_id and status not in ('completed','cancelled');

  if not found then raise exception 'order_not_cancellable'; end if;

  update public.dispatch_offers
  set status='cancelled',responded_at=coalesce(responded_at,now())
  where order_id=p_order_id and status='available';

  update public.agent_ledger
  set status='void'
  where order_id=p_order_id and status in ('pending','available');

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(
    p_order_id,'cancelled','تم إلغاء الطلب',
    case
      when v_paid and nullif(trim(p_reason),'') is not null then trim(p_reason)||' • رد المبلغ قيد المعالجة'
      when v_paid then 'رد المبلغ قيد المعالجة'
      else nullif(trim(p_reason),'')
    end,
    true,auth.uid()
  );

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_cancelled','order',p_order_id::text,jsonb_build_object('reason',p_reason,'refund_pending',v_paid));
end;
$function$;

create or replace function public.admin_update_order(
  p_order_id uuid,
  p_status public.order_status,
  p_official_fees numeric default null,
  p_total_amount numeric default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $function$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status='cancelled' then raise exception 'use_admin_cancel_order'; end if;

  update public.orders
  set status=p_status,
      official_fees=coalesce(p_official_fees,official_fees),
      total_amount=coalesce(p_total_amount,total_amount),
      completed_at=case when p_status='completed' then coalesce(completed_at,now()) else completed_at end
  where id=p_order_id;

  if not found then raise exception 'order_not_found'; end if;

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(p_order_id,p_status,public.order_status_label_ar(p_status),nullif(trim(p_note),''),true,auth.uid());

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_admin_updated','order',p_order_id::text,
         jsonb_build_object('status',p_status,'official_fees',p_official_fees,'total_amount',p_total_amount));
end;
$function$;

create or replace function public.update_order_status(
  p_order_id uuid,
  p_status public.order_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $function$
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
      raise exception 'agent_cannot_cancel_order';
    elsif p_status='completed' then
      if exists(
        select 1 from public.order_workflow_steps
        where order_id=p_order_id and completed_at is null
      ) then raise exception 'workflow_incomplete'; end if;

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

      if v_next.id is null or v_next.status<>p_status then
        raise exception 'invalid_status_transition';
      end if;
    end if;
  end if;

  if p_status not in ('completed','cancelled') then
    update public.order_workflow_steps
    set completed_at=coalesce(completed_at,now())
    where order_id=p_order_id and status=p_status;
  end if;

  select label_ar into v_label
  from public.order_workflow_steps
  where order_id=p_order_id and status=p_status
  limit 1;

  update public.orders
  set status=p_status,
      completed_at=case when p_status='completed' then now() else completed_at end
  where id=p_order_id;

  insert into public.order_events(order_id,status,label_ar,note,created_by)
  values(
    p_order_id,p_status,
    coalesce(v_label,public.order_status_label_ar(p_status)),
    nullif(trim(p_note),''),
    auth.uid()
  );

  if p_status='completed' and v_agent is not null then
    update public.agent_ledger
    set status='available',available_at=now()
    where order_id=p_order_id and agent_id=v_agent and entry_type='job_earning' and status='pending';

    update public.agent_profiles
    set completed_orders=completed_orders+1
    where user_id=v_agent;
  end if;
end;
$function$;
