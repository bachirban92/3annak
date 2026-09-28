-- Verify uploaded order files server-side before creating document records.
drop policy if exists "documents customer attachment insert" on public.documents;

create or replace function public.register_customer_attachment(
  p_order_id uuid,p_storage_path text,p_original_name text,p_mime_type text,p_file_size bigint
) returns public.documents
language plpgsql security definer set search_path=''
as $$
declare
  v_doc public.documents;
  v_status public.order_status;
  v_agent uuid;
  v_size bigint;
  v_mime text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select status,assigned_agent_id into v_status,v_agent
  from public.orders
  where id=p_order_id and customer_id=auth.uid()
  for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status<>'submitted' or v_agent is not null then raise exception 'order_not_editable'; end if;

  if split_part(p_storage_path,'/',1)<>p_order_id::text
     or split_part(p_storage_path,'/',2)<>'customer'
     or split_part(p_storage_path,'/',3)<>auth.uid()::text
  then raise exception 'invalid_storage_path'; end if;

  select coalesce((metadata->>'size')::bigint,(metadata->>'contentLength')::bigint),
         metadata->>'mimetype'
  into v_size,v_mime
  from storage.objects
  where bucket_id='order-files' and name=p_storage_path;

  if v_size is null then raise exception 'file_not_uploaded'; end if;
  if v_size<=0 or v_size>10*1024*1024 then raise exception 'invalid_file_size'; end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png','image/webp')
    then raise exception 'unsupported_file_type'; end if;
  if nullif(trim(p_original_name),'') is null then raise exception 'file_name_required'; end if;

  insert into public.documents(
    order_id,kind,storage_path,original_name,mime_type,file_size,visible_to_customer,uploaded_by
  ) values(
    p_order_id,'customer_attachment',p_storage_path,trim(p_original_name),v_mime,v_size,true,auth.uid()
  )
  returning * into v_doc;

  return v_doc;
end $$;

create or replace function public.complete_order_requirement(
  p_order_requirement_id uuid,p_value_text text default null,p_document_id uuid default null
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
      and d.uploaded_by=auth.uid() and d.kind='customer_attachment'
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
  v_visible boolean;
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

  select coalesce((metadata->>'size')::bigint,(metadata->>'contentLength')::bigint),
         metadata->>'mimetype'
  into v_size,v_mime
  from storage.objects
  where bucket_id='order-files' and name=p_storage_path;

  if v_size is null then raise exception 'file_not_uploaded'; end if;
  if v_size<=0 or v_size>10*1024*1024 then raise exception 'invalid_file_size'; end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png','image/webp')
    then raise exception 'unsupported_file_type'; end if;
  if nullif(trim(p_original_name),'') is null then raise exception 'file_name_required'; end if;

  v_visible:=(v_status='completed');

  select * into v_doc from public.documents
  where deliverable_id=p_deliverable_id and kind='final_document' limit 1;

  if v_doc.id is null then
    insert into public.documents(
      order_id,deliverable_id,kind,storage_path,original_name,mime_type,file_size,visible_to_customer,uploaded_by
    ) values(
      v_order_id,p_deliverable_id,'final_document',p_storage_path,trim(p_original_name),v_mime,v_size,v_visible,auth.uid()
    ) returning * into v_doc;
  else
    update public.documents
    set storage_path=p_storage_path,original_name=trim(p_original_name),mime_type=v_mime,file_size=v_size,
        visible_to_customer=v_visible,uploaded_by=auth.uid(),verified_by=null,verified_at=null
    where id=v_doc.id
    returning * into v_doc;
  end if;

  return v_doc;
end $$;
