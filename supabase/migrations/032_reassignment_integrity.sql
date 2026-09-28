-- Reassignment/payment ledger integrity.
drop index if exists public.uq_agent_job_earning;
create unique index uq_agent_job_earning_active
on public.agent_ledger(order_id,agent_id,entry_type)
where entry_type='job_earning' and order_id is not null and status<>'void';

create or replace function public.admin_reassign_order(
  p_order_id uuid,p_agent_id uuid,p_reason text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_old_agent uuid;
  v_status public.order_status;
  v_governorate text;
  v_ready boolean;
  v_total numeric(10,2);
  v_new_status public.order_status;
  v_payout numeric(10,2);
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select assigned_agent_id,status,governorate,customer_submission_ready,total_amount
  into v_old_agent,v_status,v_governorate,v_ready,v_total
  from public.orders where id=p_order_id for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status in ('completed','cancelled') then raise exception 'order_closed'; end if;

  if v_status='submitted' then
    if not coalesce(v_ready,false) then raise exception 'order_not_ready_for_assignment'; end if;
    if exists(
      select 1 from public.order_requirements
      where order_id=p_order_id and required=true and completed_at is null
    ) then raise exception 'requirements_incomplete'; end if;
    if private.payments_enforced() and v_total>0 and not exists(
      select 1 from public.payments where order_id=p_order_id and status='paid'
    ) then raise exception 'payment_required'; end if;
  end if;

  if not exists(
    select 1 from public.agent_profiles ap
    where ap.user_id=p_agent_id and ap.verification_status='approved'
      and exists(
        select 1 from public.agent_coverage ac
        where ac.agent_id=ap.user_id and ac.active=true
          and lower(trim(ac.governorate))=lower(trim(v_governorate))
      )
  ) then raise exception 'agent_not_eligible'; end if;

  if v_old_agent=p_agent_id then raise exception 'agent_already_assigned'; end if;

  v_new_status:=case when v_status='submitted' then 'accepted'::public.order_status else v_status end;

  update public.orders
  set assigned_agent_id=p_agent_id,
      status=v_new_status,
      accepted_at=case when v_status='submitted' then now() else accepted_at end
  where id=p_order_id;

  insert into public.order_assignment_history(order_id,from_agent_id,to_agent_id,changed_by,reason)
  values(p_order_id,v_old_agent,p_agent_id,auth.uid(),nullif(trim(p_reason),''));

  update public.dispatch_offers
  set status=case when agent_id=p_agent_id then 'accepted'::public.offer_status else 'cancelled'::public.offer_status end,
      responded_at=now()
  where order_id=p_order_id and status='available';

  if v_old_agent is not null then
    update public.agent_ledger set status='void'
    where order_id=p_order_id and agent_id=v_old_agent and entry_type='job_earning'
      and status in ('pending','available');
  end if;

  select coalesce(sum(oi.agent_payout),0)+coalesce(o.delivery_agent_payout,0)
  into v_payout
  from public.order_items oi
  join public.orders o on o.id=oi.order_id
  where oi.order_id=p_order_id
  group by o.delivery_agent_payout;

  insert into public.agent_ledger(agent_id,order_id,entry_type,amount,status,description)
  values(
    p_agent_id,p_order_id,'job_earning',coalesce(v_payout,0),'pending',
    case when exists(select 1 from public.orders where id=p_order_id and delivery_mode='hard_copy')
      then 'بدل تنفيذ الطلب + توصيل النسخة الورقية'
      else 'بدل تنفيذ الطلب'
    end
  )
  on conflict do nothing;

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(
    p_order_id,v_new_status,
    case when v_old_agent is null then 'تم تعيين وكيل للطلب' else 'تم إعادة تعيين وكيل للطلب' end,
    nullif(trim(p_reason),''),true,auth.uid()
  );

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  values(
    p_agent_id,p_order_id,'in_app',
    case when v_old_agent is null then 'تم تعيين طلب لك' else 'تم إعادة تعيين طلب لك' end,
    'لديك طلب يحتاج المتابعة',now()
  );

  if v_old_agent is not null then
    insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
    values(v_old_agent,p_order_id,'in_app','تمت إعادة تعيين الطلب','لم يعد هذا الطلب معيّناً لك',now());
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_reassigned','order',p_order_id::text,
    jsonb_build_object('from_agent',v_old_agent,'to_agent',p_agent_id,'reason',p_reason,'preserved_status',v_new_status));
end $$;
