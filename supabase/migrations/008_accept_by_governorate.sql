create or replace function public.accept_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_payout numeric(10,2);
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if not exists (
    select 1 from public.agent_profiles ap
    where ap.user_id=auth.uid()
      and ap.verification_status='approved'
      and ap.available=true
  ) then
    raise exception 'agent_not_eligible';
  end if;

  update public.orders o
  set assigned_agent_id=auth.uid(),
      status='accepted',
      accepted_at=now()
  where o.id=p_order_id
    and o.status='submitted'
    and o.assigned_agent_id is null
    and exists (
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid()
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  returning o.* into v_order;

  if v_order.id is null then
    raise exception 'order_unavailable';
  end if;

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

revoke execute on function public.accept_order(uuid) from public,anon;
grant execute on function public.accept_order(uuid) to authenticated;
