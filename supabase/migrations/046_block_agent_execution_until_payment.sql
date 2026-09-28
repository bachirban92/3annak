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
  v_total numeric(10,2);
  v_doc public.documents;
  v_visible boolean;
  v_size bigint;
  v_mime text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select d.order_id,o.assigned_agent_id,o.status,o.total_amount
  into v_order_id,v_assigned_agent,v_status,v_total
  from public.order_deliverables d
  join public.orders o on o.id=d.order_id
  where d.id=p_deliverable_id
  for update of o;

  if v_order_id is null then raise exception 'deliverable_not_found'; end if;

  if not private.is_admin() then
    if v_assigned_agent is distinct from auth.uid() then raise exception 'not_authorized'; end if;
    if v_status in ('completed','cancelled') then raise exception 'order_closed'; end if;
    if private.payments_enforced()
       and v_total>0
       and not exists(select 1 from public.payments p where p.order_id=v_order_id and p.status='paid')
    then raise exception 'payment_required'; end if;
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

  v_visible:=(v_status='completed');

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
      v_visible,auth.uid()
    )
    returning * into v_doc;
  else
    update public.documents
    set storage_path=p_storage_path,
        original_name=trim(p_original_name),
        mime_type=v_mime,
        file_size=v_size,
        visible_to_customer=v_visible,
        uploaded_by=auth.uid(),
        verified_by=null,
        verified_at=null
    where id=v_doc.id
    returning * into v_doc;
  end if;

  return v_doc;
end;
$$;

create or replace function public.confirm_hard_copy_delivery(p_order_id uuid,p_note text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_status public.order_status;
  v_total numeric(10,2);
begin
  select status,total_amount into v_status,v_total
  from public.orders
  where id=p_order_id
    and assigned_agent_id=auth.uid()
    and delivery_mode='hard_copy'
    and hard_copy_delivered_at is null
  for update;

  if v_status is null or v_status in ('cancelled','completed') then
    raise exception 'delivery_not_available';
  end if;

  if private.payments_enforced()
     and v_total>0
     and not exists(select 1 from public.payments p where p.order_id=p_order_id and p.status='paid')
  then raise exception 'payment_required'; end if;

  update public.orders
  set hard_copy_delivered_at=now(),
      hard_copy_delivery_note=nullif(trim(p_note),''),
      updated_at=now()
  where id=p_order_id;

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(
    p_order_id,v_status,'تم توصيل النسخة الورقية',
    nullif(trim(p_note),''),true,auth.uid()
  );
end;
$$;
