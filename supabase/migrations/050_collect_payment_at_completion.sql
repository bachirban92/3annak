create or replace function public.submit_order_deliverable(
  p_deliverable_id uuid,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_file_size bigint
) returns public.documents
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_assigned_agent uuid;
  v_status public.order_status;
  v_doc public.documents;
  v_size bigint;
  v_mime text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select d.order_id,o.assigned_agent_id,o.status
  into v_order_id,v_assigned_agent,v_status
  from public.order_deliverables d
  join public.orders o on o.id=d.order_id
  where d.id=p_deliverable_id
  for update of o;

  if v_order_id is null then raise exception 'deliverable_not_found'; end if;

  if not private.is_admin() then
    if v_assigned_agent is distinct from auth.uid() then raise exception 'not_authorized'; end if;
    if v_status in ('completed','cancelled') then raise exception 'order_closed'; end if;
    if split_part(p_storage_path,'/',1)<>v_order_id::text
       or split_part(p_storage_path,'/',2)<>'agent'
       or split_part(p_storage_path,'/',3)<>auth.uid()::text
    then raise exception 'invalid_storage_path'; end if;
  else
    if v_status='cancelled' then raise exception 'order_closed'; end if;
    if split_part(p_storage_path,'/',1)<>v_order_id::text then raise exception 'invalid_storage_path'; end if;
  end if;

  select
    coalesce((metadata->>'size')::bigint,(metadata->>'contentLength')::bigint),
    metadata->>'mimetype'
  into v_size,v_mime
  from storage.objects
  where bucket_id='order-files' and name=p_storage_path;

  if v_size is null then raise exception 'file_not_uploaded'; end if;
  if v_size<=0 or v_size>10*1024*1024 then raise exception 'invalid_file_size'; end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png','image/webp')
    then raise exception 'unsupported_file_type'; end if;
  if nullif(trim(p_original_name),'') is null then raise exception 'file_name_required'; end if;

  select * into v_doc
  from public.documents
  where deliverable_id=p_deliverable_id and kind='final_document'
  limit 1;

  if v_doc.id is null then
    insert into public.documents(
      order_id,deliverable_id,kind,storage_path,original_name,mime_type,file_size,
      visible_to_customer,uploaded_by
    )
    values(
      v_order_id,p_deliverable_id,'final_document',p_storage_path,trim(p_original_name),v_mime,v_size,
      false,auth.uid()
    )
    returning * into v_doc;
  else
    update public.documents
    set storage_path=p_storage_path,
        original_name=trim(p_original_name),
        mime_type=v_mime,
        file_size=v_size,
        visible_to_customer=false,
        uploaded_by=auth.uid(),
        verified_by=null,
        verified_at=null
    where id=v_doc.id
    returning * into v_doc;
  end if;

  return v_doc;
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

  if p_status='completed' then
    if private.payments_enforced()
       and v_total>0
       and not exists(select 1 from public.payments p where p.order_id=p_order_id and p.status='paid')
    then raise exception 'payment_required'; end if;

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

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  values(
    v_order.customer_id,p_order_id,'in_app',
    'تم قبول طلبك',
    'بدأ الوكيل متابعة طلبك. الدفع النقدي يكون عند انتهاء العمل وقبل تسليم المستندات.',
    now()
  );

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
