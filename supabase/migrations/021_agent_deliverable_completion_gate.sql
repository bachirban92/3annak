alter table public.documents
  add column if not exists deliverable_id uuid references public.order_deliverables(id) on delete set null;

create unique index if not exists uq_documents_final_deliverable
on public.documents(deliverable_id)
where deliverable_id is not null and kind='final_document';

create index if not exists idx_documents_deliverable_id
on public.documents(deliverable_id);

create or replace function public.submit_order_deliverable(
  p_deliverable_id uuid,p_storage_path text,p_original_name text,p_mime_type text,p_file_size bigint
)
returns public.documents
language plpgsql security definer set search_path='' as $$
declare
  v_order_id uuid;
  v_assigned_agent uuid;
  v_doc public.documents;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select d.order_id,o.assigned_agent_id
  into v_order_id,v_assigned_agent
  from public.order_deliverables d
  join public.orders o on o.id=d.order_id
  where d.id=p_deliverable_id;

  if v_order_id is null then raise exception 'deliverable_not_found'; end if;
  if v_assigned_agent is distinct from auth.uid() and not public.is_admin() then raise exception 'not_authorized'; end if;
  if split_part(p_storage_path,'/',1) <> v_order_id::text then raise exception 'invalid_storage_path'; end if;

  select * into v_doc
  from public.documents
  where deliverable_id=p_deliverable_id and kind='final_document'
  limit 1;

  if v_doc.id is null then
    insert into public.documents(
      order_id,deliverable_id,kind,storage_path,original_name,mime_type,file_size,visible_to_customer,uploaded_by
    )
    values(
      v_order_id,p_deliverable_id,'final_document',p_storage_path,p_original_name,p_mime_type,p_file_size,true,auth.uid()
    )
    returning * into v_doc;
  else
    update public.documents
    set storage_path=p_storage_path,original_name=p_original_name,mime_type=p_mime_type,file_size=p_file_size,
        visible_to_customer=true,uploaded_by=auth.uid(),verified_by=null,verified_at=null
    where id=v_doc.id
    returning * into v_doc;
  end if;

  return v_doc;
end;
$$;

create or replace function public.update_order_status(
  p_order_id uuid,p_status public.order_status,p_note text default null
)
returns void
language plpgsql security definer set search_path='' as $$
declare
  v_current public.order_status;
  v_agent uuid;
begin
  select status,assigned_agent_id into v_current,v_agent
  from public.orders where id=p_order_id for update;

  if v_current is null then raise exception 'order_not_found'; end if;

  if not public.is_admin() and v_agent <> auth.uid() then raise exception 'not_authorized'; end if;

  if not public.is_admin() then
    if not (
      (v_current='accepted' and p_status in ('in_progress','cancelled')) or
      (v_current='in_progress' and p_status in ('submitted_to_authority','processing','cancelled')) or
      (v_current='submitted_to_authority' and p_status in ('processing','ready_for_collection','cancelled')) or
      (v_current='processing' and p_status in ('ready_for_collection','cancelled')) or
      (v_current='ready_for_collection' and p_status in ('collected','cancelled')) or
      (v_current='collected' and p_status in ('completed','cancelled'))
    ) then raise exception 'invalid_status_transition'; end if;
  end if;

  if p_status='completed' and exists(
    select 1
    from public.order_deliverables od
    where od.order_id=p_order_id
      and not exists(
        select 1 from public.documents d
        where d.deliverable_id=od.id and d.order_id=p_order_id and d.kind='final_document'
      )
  ) then raise exception 'deliverables_incomplete'; end if;

  update public.orders
  set status=p_status,
      completed_at=case when p_status='completed' then now() else completed_at end,
      cancelled_at=case when p_status='cancelled' then now() else cancelled_at end
  where id=p_order_id;

  insert into public.order_events(order_id,status,label_ar,note,created_by)
  values(p_order_id,p_status,public.order_status_label_ar(p_status),nullif(trim(p_note),''),auth.uid());

  if p_status='completed' and v_agent is not null then
    update public.agent_ledger
    set status='available',available_at=now()
    where order_id=p_order_id and agent_id=v_agent and entry_type='job_earning' and status='pending';

    update public.agent_profiles
    set completed_orders=completed_orders+1
    where user_id=v_agent;
  end if;
end;
$$;

revoke execute on function public.submit_order_deliverable(uuid,text,text,text,bigint) from public,anon;
grant execute on function public.submit_order_deliverable(uuid,text,text,text,bigint) to authenticated;
