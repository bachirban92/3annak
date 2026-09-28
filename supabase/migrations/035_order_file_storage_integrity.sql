-- Namespace order files by uploader role/user and enforce safe read/delete rules.
drop policy if exists "order files insert" on storage.objects;
drop policy if exists "order files read" on storage.objects;
drop policy if exists "order files delete" on storage.objects;

create policy "order files insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id='order-files'
  and (
    private.is_admin()
    or (
      (storage.foldername(name))[1] is not null
      and (storage.foldername(name))[2] in ('customer','agent')
      and (storage.foldername(name))[3]=auth.uid()::text
      and exists(
        select 1 from public.orders o
        where o.id::text=(storage.foldername(name))[1]
          and (
            (
              (storage.foldername(name))[2]='customer'
              and o.customer_id=auth.uid()
              and o.status='submitted'
              and o.assigned_agent_id is null
            )
            or
            (
              (storage.foldername(name))[2]='agent'
              and o.assigned_agent_id=auth.uid()
              and o.status not in ('completed','cancelled')
            )
          )
      )
    )
  )
);

create policy "order files read"
on storage.objects
for select to authenticated
using (
  bucket_id='order-files'
  and (
    private.is_admin()
    or exists(
      select 1
      from public.documents d
      join public.orders o on o.id=d.order_id
      where d.storage_path=objects.name
        and (
          d.uploaded_by=auth.uid()
          or o.assigned_agent_id=auth.uid()
          or (o.customer_id=auth.uid() and d.visible_to_customer=true)
        )
    )
  )
);

create policy "order files delete"
on storage.objects
for delete to authenticated
using (
  bucket_id='order-files'
  and (
    private.is_admin()
    or (
      (storage.foldername(name))[1] is not null
      and (storage.foldername(name))[2] in ('customer','agent')
      and (storage.foldername(name))[3]=auth.uid()::text
      and exists(
        select 1 from public.orders o
        where o.id::text=(storage.foldername(name))[1]
          and (
            (
              (storage.foldername(name))[2]='customer'
              and o.customer_id=auth.uid()
              and o.status='submitted'
              and o.assigned_agent_id is null
            )
            or
            (
              (storage.foldername(name))[2]='agent'
              and o.assigned_agent_id=auth.uid()
              and o.status not in ('completed','cancelled')
            )
          )
      )
    )
  )
);

drop policy if exists "documents customer attachment delete" on public.documents;
create policy "documents customer attachment delete"
on public.documents
for delete to authenticated
using (
  kind='customer_attachment'
  and uploaded_by=auth.uid()
  and exists(
    select 1 from public.orders o
    where o.id=documents.order_id
      and o.customer_id=auth.uid()
      and o.status='submitted'
      and o.assigned_agent_id is null
  )
);

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

  if nullif(trim(p_original_name),'') is null then raise exception 'file_name_required'; end if;
  if coalesce(p_file_size,0)<=0 then raise exception 'file_empty'; end if;

  v_visible:=(v_status='completed');

  select * into v_doc from public.documents
  where deliverable_id=p_deliverable_id and kind='final_document' limit 1;

  if v_doc.id is null then
    insert into public.documents(
      order_id,deliverable_id,kind,storage_path,original_name,mime_type,file_size,visible_to_customer,uploaded_by
    ) values(
      v_order_id,p_deliverable_id,'final_document',p_storage_path,p_original_name,p_mime_type,p_file_size,v_visible,auth.uid()
    ) returning * into v_doc;
  else
    update public.documents
    set storage_path=p_storage_path,original_name=p_original_name,mime_type=p_mime_type,file_size=p_file_size,
        visible_to_customer=v_visible,uploaded_by=auth.uid(),verified_by=null,verified_at=null
    where id=v_doc.id
    returning * into v_doc;
  end if;

  return v_doc;
end $$;
