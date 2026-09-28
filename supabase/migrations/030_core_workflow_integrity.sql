-- Core workflow integrity hardening.
create unique index if not exists uq_agent_job_earning
on public.agent_ledger(order_id,agent_id,entry_type)
where entry_type='job_earning' and order_id is not null;

create or replace function public.complete_order_requirement(
  p_order_requirement_id uuid,
  p_value_text text default null,
  p_document_id uuid default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_order_id uuid;
  v_type text;
  v_status public.order_status;
  v_assigned uuid;
begin
  select r.order_id,r.requirement_type,o.status,o.assigned_agent_id
  into v_order_id,v_type,v_status,v_assigned
  from public.order_requirements r
  join public.orders o on o.id=r.order_id
  where r.id=p_order_requirement_id and o.customer_id=auth.uid()
  for update of o;

  if v_order_id is null then raise exception 'requirement_not_found'; end if;
  if v_status<>'submitted' or v_assigned is not null then raise exception 'requirements_locked'; end if;
  if v_type='file' and p_document_id is null then raise exception 'document_required'; end if;
  if v_type='text' and nullif(trim(p_value_text),'') is null then raise exception 'value_required'; end if;

  if p_document_id is not null and not exists(
    select 1 from public.documents d
    where d.id=p_document_id and d.order_id=v_order_id
      and d.uploaded_by=auth.uid() and d.kind<>'final_document'
  ) then raise exception 'invalid_document'; end if;

  update public.order_requirements
  set value_text=nullif(trim(p_value_text),''),
      document_id=p_document_id,
      completed_at=now()
  where id=p_order_requirement_id;

  perform public.try_dispatch_order(v_order_id);
end $$;

create or replace function public.submit_order_deliverable(
  p_deliverable_id uuid,p_storage_path text,p_original_name text,p_mime_type text,p_file_size bigint
) returns public.documents
language plpgsql security definer set search_path=''
as $$
declare
  v_order_id uuid;
  v_assigned_agent uuid;
  v_status public.order_status;
  v_doc public.documents;
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
  elsif v_status='cancelled' then
    raise exception 'order_closed';
  end if;

  if split_part(p_storage_path,'/',1) <> v_order_id::text then raise exception 'invalid_storage_path'; end if;
  if nullif(trim(p_original_name),'') is null then raise exception 'file_name_required'; end if;
  if coalesce(p_file_size,0)<=0 then raise exception 'file_empty'; end if;

  select * into v_doc from public.documents
  where deliverable_id=p_deliverable_id and kind='final_document' limit 1;

  if v_doc.id is null then
    insert into public.documents(
      order_id,deliverable_id,kind,storage_path,original_name,mime_type,file_size,visible_to_customer,uploaded_by
    ) values(
      v_order_id,p_deliverable_id,'final_document',p_storage_path,p_original_name,p_mime_type,p_file_size,true,auth.uid()
    ) returning * into v_doc;
  else
    update public.documents
    set storage_path=p_storage_path,original_name=p_original_name,mime_type=p_mime_type,file_size=p_file_size,
        visible_to_customer=true,uploaded_by=auth.uid(),verified_by=null,verified_at=null
    where id=v_doc.id
    returning * into v_doc;
  end if;

  return v_doc;
end $$;

create or replace function public.update_order_status(
  p_order_id uuid,p_status public.order_status,p_note text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_current public.order_status;
  v_agent uuid;
  v_next public.order_workflow_steps;
  v_label text;
  v_delivery text;
  v_hard_delivered timestamptz;
begin
  select status,assigned_agent_id,delivery_mode,hard_copy_delivered_at
  into v_current,v_agent,v_delivery,v_hard_delivered
  from public.orders where id=p_order_id for update;

  if v_current is null then raise exception 'order_not_found'; end if;
  if v_current in ('completed','cancelled') then raise exception 'order_closed'; end if;
  if not private.is_admin() and v_agent<>auth.uid() then raise exception 'not_authorized'; end if;

  if p_status='cancelled' then
    if not private.is_admin() then raise exception 'agent_cannot_cancel_order'; end if;
    raise exception 'use_admin_cancel_order';
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
    if v_delivery='hard_copy' and v_hard_delivered is null then raise exception 'hard_copy_delivery_incomplete'; end if;
  else
    select * into v_next from public.order_workflow_steps
    where order_id=p_order_id and completed_at is null
    order by sort_order,id limit 1;
    if v_next.id is null or v_next.status<>p_status then raise exception 'invalid_status_transition'; end if;
  end if;

  if p_status<>'completed' then
    update public.order_workflow_steps set completed_at=coalesce(completed_at,now())
    where order_id=p_order_id and status=p_status;
  end if;

  select label_ar into v_label from public.order_workflow_steps
  where order_id=p_order_id and status=p_status limit 1;

  update public.orders
  set status=p_status,completed_at=case when p_status='completed' then now() else completed_at end
  where id=p_order_id;

  insert into public.order_events(order_id,status,label_ar,note,created_by)
  values(p_order_id,p_status,coalesce(v_label,public.order_status_label_ar(p_status)),nullif(trim(p_note),''),auth.uid());

  if p_status='completed' and v_agent is not null then
    update public.agent_ledger set status='available',available_at=coalesce(available_at,now())
    where order_id=p_order_id and agent_id=v_agent and entry_type='job_earning' and status='pending';

    update public.agent_profiles
    set completed_orders=(select count(*) from public.orders o where o.assigned_agent_id=v_agent and o.status='completed')
    where user_id=v_agent;
  end if;
end $$;

create or replace function public.admin_update_order(
  p_order_id uuid,p_status public.order_status,p_official_fees numeric default null,
  p_total_amount numeric default null,p_note text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare v_current public.order_status;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select status into v_current from public.orders where id=p_order_id for update;
  if v_current is null then raise exception 'order_not_found'; end if;
  if p_status='cancelled' then raise exception 'use_admin_cancel_order'; end if;
  if p_status is distinct from v_current then raise exception 'status_managed_by_workflow'; end if;
  if v_current in ('completed','cancelled') and (p_official_fees is not null or p_total_amount is not null)
    then raise exception 'order_closed'; end if;

  update public.orders
  set official_fees=coalesce(p_official_fees,official_fees),
      total_amount=coalesce(p_total_amount,total_amount)
  where id=p_order_id;

  if nullif(trim(p_note),'') is not null then
    insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
    values(p_order_id,v_current,public.order_status_label_ar(v_current),trim(p_note),true,auth.uid());
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_admin_updated','order',p_order_id::text,
         jsonb_build_object('status',v_current,'official_fees',p_official_fees,'total_amount',p_total_amount,'note',p_note));
end $$;

create or replace function public.admin_reassign_order(
  p_order_id uuid,p_agent_id uuid,p_reason text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_old_agent uuid;
  v_status public.order_status;
  v_governorate text;
  v_new_status public.order_status;
  v_payout numeric(10,2);
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select assigned_agent_id,status,governorate
  into v_old_agent,v_status,v_governorate
  from public.orders where id=p_order_id for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status in ('completed','cancelled') then raise exception 'order_closed'; end if;

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
    where order_id=p_order_id and agent_id=v_old_agent and entry_type='job_earning' and status in ('pending','available');
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
