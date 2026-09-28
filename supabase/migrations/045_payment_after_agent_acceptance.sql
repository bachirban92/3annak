-- Customer pays only after an agent accepts. Dispatch/acceptance never require payment.
-- Execution is blocked until payment is confirmed.

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
  where id=p_order_id
    and status='submitted'
    and assigned_agent_id is null
    and customer_submission_ready=true;

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

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  select ap.user_id,v_order.id,'in_app','طلب جديد',
         'طلب جديد في '||v_order.cadastral_area||' — '||v_order.public_code,now()
  from public.agent_profiles ap
  where ap.verification_status='approved'
    and ap.available=true
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(v_order.governorate))
    )
    and not exists(
      select 1 from public.notifications n
      where n.user_id=ap.user_id and n.order_id=v_order.id and n.title='طلب جديد'
    );

  return v_count;
end;
$$;

create or replace function public.list_available_orders()
returns table(
  id uuid, public_code text, governorate text, district text, cadastral_area text,
  service_names text, agent_payout numeric, submitted_at timestamptz, delivery_mode text
)
language sql
stable security definer
set search_path=''
as $$
  select o.id,o.public_code,o.governorate,o.district,o.cadastral_area,
    string_agg(oi.service_name_ar,'، ' order by oi.created_at),
    sum(oi.agent_payout)+o.delivery_agent_payout,o.submitted_at,o.delivery_mode
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  join public.agent_profiles ap on ap.user_id=auth.uid()
  where o.status='submitted'
    and o.customer_submission_ready=true
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
  group by o.id,o.public_code,o.governorate,o.district,o.cadastral_area,
           o.submitted_at,o.delivery_agent_payout,o.delivery_mode
  order by o.submitted_at asc;
$$;

create or replace function public.accept_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path=''
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
  where o.id=p_order_id
    and o.status='submitted'
    and o.customer_submission_ready=true
    and o.assigned_agent_id is null
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

  if v_order.total_amount>0
     and not exists(select 1 from public.payments where order_id=p_order_id and status='paid')
  then
    insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
    values(
      v_order.customer_id,p_order_id,'in_app',
      'حان وقت الدفع',
      'تم قبول طلبك من وكيل. أكمل الدفع ليبدأ تنفيذ الطلب.',
      now()
    );
  end if;

  select coalesce(sum(agent_payout),0)+coalesce(v_order.delivery_agent_payout,0)
  into v_payout
  from public.order_items
  where order_id=p_order_id;

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
end;
$$;

create or replace function public.admin_reassign_order(p_order_id uuid,p_agent_id uuid,p_reason text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old_agent uuid;
  v_status public.order_status;
  v_governorate text;
  v_ready boolean;
  v_total numeric(10,2);
  v_customer uuid;
  v_new_status public.order_status;
  v_payout numeric(10,2);
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select assigned_agent_id,status,governorate,customer_submission_ready,total_amount,customer_id
  into v_old_agent,v_status,v_governorate,v_ready,v_total,v_customer
  from public.orders where id=p_order_id for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status in ('completed','cancelled') then raise exception 'order_closed'; end if;

  if v_status='submitted' then
    if not coalesce(v_ready,false) then raise exception 'order_not_ready_for_assignment'; end if;
    if exists(
      select 1 from public.order_requirements
      where order_id=p_order_id and required=true and completed_at is null
    ) then raise exception 'requirements_incomplete'; end if;
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
    case when v_total>0 and not exists(select 1 from public.payments where order_id=p_order_id and status='paid')
      then 'بانتظار دفع العميل قبل بدء التنفيذ'
      else 'لديك طلب يحتاج المتابعة'
    end,
    now()
  );

  if v_status='submitted'
     and v_total>0
     and not exists(select 1 from public.payments where order_id=p_order_id and status='paid')
  then
    insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
    values(v_customer,p_order_id,'in_app','حان وقت الدفع','تم تعيين وكيل لطلبك. أكمل الدفع ليبدأ التنفيذ.',now());
  end if;

  if v_old_agent is not null then
    insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
    values(v_old_agent,p_order_id,'in_app','تمت إعادة تعيين الطلب','لم يعد هذا الطلب معيّناً لك',now());
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_reassigned','order',p_order_id::text,
    jsonb_build_object('from_agent',v_old_agent,'to_agent',p_agent_id,'reason',p_reason,'preserved_status',v_new_status));
end;
$$;

create or replace function public.update_order_status(p_order_id uuid,p_status public.order_status,p_note text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_current public.order_status;
  v_agent uuid;
  v_total numeric(10,2);
  v_next public.order_workflow_steps;
  v_label text;
  v_delivery text;
  v_hard_delivered timestamptz;
begin
  select status,assigned_agent_id,total_amount,delivery_mode,hard_copy_delivered_at
  into v_current,v_agent,v_total,v_delivery,v_hard_delivered
  from public.orders where id=p_order_id for update;

  if v_current is null then raise exception 'order_not_found'; end if;
  if v_current in ('completed','cancelled') then raise exception 'order_closed'; end if;
  if not private.is_admin() and v_agent<>auth.uid() then raise exception 'not_authorized'; end if;

  if p_status='cancelled' then
    if not private.is_admin() then raise exception 'agent_cannot_cancel_order'; end if;
    raise exception 'use_admin_cancel_order';
  end if;

  if private.payments_enforced()
     and v_total>0
     and not exists(select 1 from public.payments p where p.order_id=p_order_id and p.status='paid')
  then
    raise exception 'payment_required';
  end if;

  if p_status='completed' then
    if exists(select 1 from public.order_workflow_steps where order_id=p_order_id and completed_at is null)
      then raise exception 'workflow_incomplete'; end if;
    if exists(
      select 1 from public.order_deliverables od
      where od.order_id=p_order_id and not exists(
        select 1 from public.documents d
        where d.deliverable_id=od.id and d.order_id=p_order_id and d.kind='final_document'
      )
    ) then raise exception 'deliverables_incomplete'; end if;
    if v_delivery='hard_copy' and v_hard_delivered is null
      then raise exception 'hard_copy_delivery_incomplete'; end if;
  else
    select * into v_next
    from public.order_workflow_steps
    where order_id=p_order_id and completed_at is null
    order by sort_order,id
    limit 1;
    if v_next.id is null or v_next.status<>p_status then raise exception 'invalid_status_transition'; end if;
  end if;

  if p_status<>'completed' then
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

  if p_status='completed' then
    update public.documents
    set visible_to_customer=true
    where order_id=p_order_id and kind='final_document';
  end if;

  insert into public.order_events(order_id,status,label_ar,note,created_by)
  values(
    p_order_id,p_status,
    coalesce(v_label,public.order_status_label_ar(p_status)),
    nullif(trim(p_note),''),
    auth.uid()
  );

  if p_status='completed' and v_agent is not null then
    update public.agent_ledger
    set status='available',available_at=coalesce(available_at,now())
    where order_id=p_order_id and agent_id=v_agent
      and entry_type='job_earning' and status='pending';

    update public.agent_profiles
    set completed_orders=(
      select count(*) from public.orders o
      where o.assigned_agent_id=v_agent and o.status='completed'
    )
    where user_id=v_agent;
  end if;
end;
$$;

update public.app_settings
set value=jsonb_set(coalesce(value,'{}'::jsonb),'{enabled}','true'::jsonb,true)
where key='payments_enforced';

revoke execute on function public.try_dispatch_order(uuid) from public, anon, authenticated;
