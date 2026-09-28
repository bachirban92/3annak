create table if not exists public.customer_identity_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  file_size bigint not null check(file_size > 0 and file_size <= 10485760),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.customer_identity_verifications enable row level security;

drop policy if exists "customer identity own or admin read" on public.customer_identity_verifications;
create policy "customer identity own or admin read"
on public.customer_identity_verifications for select to authenticated
using(user_id=(select auth.uid()) or private.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('customer-id-files','customer-id-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update
set public=false,file_size_limit=10485760,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "customer id files read" on storage.objects;
create policy "customer id files read" on storage.objects for select to authenticated
using(
  bucket_id='customer-id-files'
  and ((storage.foldername(name))[1]=(select auth.uid())::text or private.is_admin())
);

drop policy if exists "customer id files insert" on storage.objects;
create policy "customer id files insert" on storage.objects for insert to authenticated
with check(
  bucket_id='customer-id-files'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='customer')
);

drop policy if exists "customer id files delete" on storage.objects;
create policy "customer id files delete" on storage.objects for delete to authenticated
using(
  bucket_id='customer-id-files'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create or replace function public.submit_customer_identity_document(
  p_storage_path text,p_original_name text,p_mime_type text,p_file_size bigint
) returns public.customer_identity_verifications
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.customer_identity_verifications;
  v_size bigint;
  v_mime text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and role='customer')
    then raise exception 'customer_account_required'; end if;
  if split_part(p_storage_path,'/',1)<>auth.uid()::text then raise exception 'invalid_storage_path'; end if;

  select coalesce((metadata->>'size')::bigint,(metadata->>'contentLength')::bigint),
         metadata->>'mimetype'
  into v_size,v_mime
  from storage.objects
  where bucket_id='customer-id-files' and name=p_storage_path;

  if v_size is null then raise exception 'file_not_uploaded'; end if;
  if v_size<=0 or v_size>10*1024*1024 then raise exception 'invalid_file_size'; end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png','image/webp')
    then raise exception 'unsupported_file_type'; end if;
  if nullif(trim(p_original_name),'') is null then raise exception 'file_name_required'; end if;

  insert into public.customer_identity_verifications(
    user_id,storage_path,original_name,mime_type,file_size,status,rejection_reason,
    submitted_at,reviewed_by,reviewed_at,updated_at
  )
  values(
    auth.uid(),p_storage_path,trim(p_original_name),v_mime,v_size,'pending',null,
    now(),null,null,now()
  )
  on conflict(user_id) do update
  set storage_path=excluded.storage_path,
      original_name=excluded.original_name,
      mime_type=excluded.mime_type,
      file_size=excluded.file_size,
      status='pending',
      rejection_reason=null,
      submitted_at=now(),
      reviewed_by=null,
      reviewed_at=null,
      updated_at=now()
  returning * into v;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'customer_identity_submitted','customer',auth.uid()::text,
    jsonb_build_object('file_name',trim(p_original_name)));

  return v;
end;
$$;

create or replace function public.admin_review_customer_identity(
  p_user_id uuid,p_status text,p_reason text default null
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'invalid_status'; end if;

  update public.customer_identity_verifications
  set status=p_status,
      rejection_reason=case when p_status='rejected' then nullif(trim(p_reason),'') else null end,
      reviewed_by=auth.uid(),
      reviewed_at=now(),
      updated_at=now()
  where user_id=p_user_id;

  if not found then raise exception 'verification_not_found'; end if;

  insert into public.notifications(user_id,channel,title,body,sent_at)
  values(
    p_user_id,'in_app',
    case when p_status='approved' then 'تم التحقق من الهوية' else 'تعذر التحقق من الهوية' end,
    case when p_status='approved'
      then 'تم اعتماد هويتك ويمكنك الآن تقديم الطلبات.'
      else coalesce(nullif(trim(p_reason),''),'يرجى رفع إثبات هوية واضح وإعادة المحاولة.')
    end,
    now()
  );

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'customer_identity_reviewed','customer',p_user_id::text,
    jsonb_build_object('status',p_status,'reason',p_reason));
end;
$$;

create or replace function private.enforce_customer_identity_before_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is not null
     and new.customer_id=auth.uid()
     and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='customer')
     and not exists(
       select 1 from public.customer_identity_verifications v
       where v.user_id=auth.uid() and v.status='approved'
     )
  then
    raise exception 'customer_identity_required';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_require_customer_identity on public.orders;
create trigger orders_require_customer_identity
before insert on public.orders
for each row execute function private.enforce_customer_identity_before_order();

revoke execute on function public.submit_customer_identity_document(text,text,text,bigint) from public,anon;
revoke execute on function public.admin_review_customer_identity(uuid,text,text) from public,anon;
grant execute on function public.submit_customer_identity_document(text,text,text,bigint) to authenticated;
grant execute on function public.admin_review_customer_identity(uuid,text,text) to authenticated;

grant select on public.customer_identity_verifications to authenticated;
