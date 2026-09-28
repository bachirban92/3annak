-- Prevent partially prepared customer orders from dispatching before the UI has finished saving all inputs.
alter table public.orders
add column if not exists customer_submission_ready boolean not null default false;

create index if not exists idx_orders_dispatch_ready
on public.orders(status,customer_submission_ready,assigned_agent_id,submitted_at);

create or replace function public.finalize_order_submission(p_order_id uuid)
returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_status public.order_status;
  v_agent uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select status,assigned_agent_id
  into v_status,v_agent
  from public.orders
  where id=p_order_id and customer_id=auth.uid()
  for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status<>'submitted' or v_agent is not null then raise exception 'order_not_editable'; end if;

  if exists(
    select 1 from public.order_requirements
    where order_id=p_order_id and required=true and completed_at is null
  ) then raise exception 'requirements_incomplete'; end if;

  update public.orders set customer_submission_ready=true where id=p_order_id;
  perform public.try_dispatch_order(p_order_id);
end $$;

create or replace function public.try_dispatch_order(p_order_id uuid)
returns integer
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.orders;
  v_count integer := 0;
begin
  select * into v_order
  from public.orders
  where id=p_order_id and status='submitted'
    and assigned_agent_id is null and customer_submission_ready=true;

  if v_order.id is null then return 0; end if;

  if private.payments_enforced() and v_order.total_amount>0
     and not exists(select 1 from public.payments p where p.order_id=p_order_id and p.status='paid')
  then return 0; end if;

  if exists(
    select 1 from public.order_requirements r
    where r.order_id=p_order_id and r.required=true and r.completed_at is null
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select v_order.id,ap.user_id,'available'
  from public.agent_profiles ap
  where ap.verification_status='approved' and ap.available=true
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(v_order.governorate))
    )
  on conflict(order_id,agent_id) do nothing;

  get diagnostics v_count = row_count;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  select ap.user_id,v_order.id,'in_app','طلب جديد',
         'طلب جديد في '||v_order.cadastral_area||' — '||v_order.public_code,now()
  from public.agent_profiles ap
  where ap.verification_status='approved' and ap.available=true
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(v_order.governorate))
    )
    and not exists(
      select 1 from public.notifications n
      where n.user_id=ap.user_id and n.order_id=v_order.id and n.title='طلب جديد'
    );

  return v_count;
end $$;

create or replace function public.refresh_agent_dispatch()
returns integer
language plpgsql security definer set search_path=''
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(
    select 1 from public.agent_profiles
    where user_id=auth.uid() and verification_status='approved' and available=true
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select o.id,auth.uid(),'available'
  from public.orders o
  where o.status='submitted' and o.customer_submission_ready=true
    and o.assigned_agent_id is null
    and (not private.payments_enforced() or o.total_amount<=0 or exists(
      select 1 from public.payments p where p.order_id=o.id and p.status='paid'
    ))
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid() and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  on conflict(order_id,agent_id) do update
    set status=case
      when public.dispatch_offers.status in ('expired','declined','cancelled')
        then 'available'::public.offer_status
      else public.dispatch_offers.status
    end;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.list_available_orders()
returns table(
  id uuid,public_code text,governorate text,district text,cadastral_area text,
  service_names text,agent_payout numeric,submitted_at timestamptz,delivery_mode text
)
language sql stable security definer set search_path=''
as $$
  select o.id,o.public_code,o.governorate,o.district,o.cadastral_area,
    string_agg(oi.service_name_ar,'، ' order by oi.created_at),
    sum(oi.agent_payout)+o.delivery_agent_payout,o.submitted_at,o.delivery_mode
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  join public.agent_profiles ap on ap.user_id=auth.uid()
  where o.status='submitted' and o.customer_submission_ready=true
    and o.assigned_agent_id is null
    and ap.verification_status='approved' and ap.available=true
    and (not private.payments_enforced() or o.total_amount<=0 or exists(
      select 1 from public.payments p where p.order_id=o.id and p.status='paid'
    ))
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid() and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  group by o.id,o.public_code,o.governorate,o.district,o.cadastral_area,
           o.submitted_at,o.delivery_agent_payout,o.delivery_mode
  order by o.submitted_at asc;
$$;

create or replace function public.accept_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.orders;
  v_payout numeric(10,2);
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(
    select 1 from public.agent_profiles ap
    where ap.user_id=auth.uid() and ap.verification_status='approved' and ap.available=true
  ) then raise exception 'agent_not_eligible'; end if;

  update public.orders o
  set assigned_agent_id=auth.uid(),status='accepted',accepted_at=now()
  where o.id=p_order_id and o.status='submitted'
    and o.customer_submission_ready=true
    and o.assigned_agent_id is null
    and (not private.payments_enforced() or o.total_amount<=0 or exists(
      select 1 from public.payments p where p.order_id=o.id and p.status='paid'
    ))
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid() and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  returning o.* into v_order;

  if v_order.id is null then raise exception 'order_unavailable'; end if;

  update public.dispatch_offers
  set status=case when agent_id=auth.uid() then 'accepted'::public.offer_status else 'cancelled'::public.offer_status end,
      responded_at=now()
  where order_id=p_order_id and status='available';

  insert into public.order_events(order_id,status,label_ar,created_by)
  values(p_order_id,'accepted',public.order_status_label_ar('accepted'),auth.uid());

  select coalesce(sum(agent_payout),0)+coalesce(v_order.delivery_agent_payout,0)
  into v_payout from public.order_items where order_id=p_order_id;

  insert into public.agent_ledger(agent_id,order_id,entry_type,amount,status,description)
  values(
    auth.uid(),p_order_id,'job_earning',v_payout,'pending',
    case when v_order.delivery_mode='hard_copy'
      then 'بدل تنفيذ الطلب + توصيل النسخة الورقية'
      else 'بدل تنفيذ الطلب'
    end
  )
  on conflict do nothing;

  return v_order;
end $$;
