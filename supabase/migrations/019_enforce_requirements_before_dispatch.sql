create or replace function public.list_available_orders()
returns table(
  id uuid, public_code text, governorate text, district text, cadastral_area text,
  service_names text, agent_payout numeric, submitted_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select
    o.id,o.public_code,o.governorate,o.district,o.cadastral_area,
    string_agg(oi.service_name_ar,'، ' order by oi.created_at),
    sum(oi.agent_payout),o.submitted_at
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  join public.agent_profiles ap on ap.user_id=auth.uid()
  where o.status='submitted'
    and o.assigned_agent_id is null
    and ap.verification_status='approved'
    and ap.available=true
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid()
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  group by o.id,o.public_code,o.governorate,o.district,o.cadastral_area,o.submitted_at
  order by o.submitted_at asc;
$$;

create or replace function public.refresh_agent_dispatch()
returns integer language plpgsql security definer set search_path='' as $$
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
  where o.status='submitted'
    and o.assigned_agent_id is null
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid()
        and ac.active=true
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
end;
$$;

create or replace function public.accept_order(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders; v_payout numeric(10,2);
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  if not exists(
    select 1 from public.agent_profiles ap
    where ap.user_id=auth.uid() and ap.verification_status='approved' and ap.available=true
  ) then raise exception 'agent_not_eligible'; end if;

  update public.orders o
  set assigned_agent_id=auth.uid(),status='accepted',accepted_at=now()
  where o.id=p_order_id
    and o.status='submitted'
    and o.assigned_agent_id is null
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid()
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  returning o.* into v_order;

  if v_order.id is null then raise exception 'order_unavailable'; end if;

  update public.dispatch_offers
  set status=case
      when agent_id=auth.uid() then 'accepted'::public.offer_status
      else 'cancelled'::public.offer_status
    end,
    responded_at=now()
  where order_id=p_order_id and status='available';

  insert into public.order_events(order_id,status,label_ar,created_by)
  values(p_order_id,'accepted',public.order_status_label_ar('accepted'),auth.uid());

  select coalesce(sum(agent_payout),0) into v_payout
  from public.order_items where order_id=p_order_id;

  insert into public.agent_ledger(agent_id,order_id,entry_type,amount,status,description)
  values(auth.uid(),p_order_id,'job_earning',v_payout,'pending','بدل تنفيذ الطلب');

  return v_order;
end;
$$;

revoke execute on function public.list_available_orders() from public,anon;
revoke execute on function public.refresh_agent_dispatch() from public,anon;
revoke execute on function public.accept_order(uuid) from public,anon;
grant execute on function public.list_available_orders() to authenticated;
grant execute on function public.refresh_agent_dispatch() to authenticated;
grant execute on function public.accept_order(uuid) to authenticated;
