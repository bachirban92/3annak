alter table public.customer_identity_verifications
  alter column storage_path drop not null;

alter table public.customer_identity_verifications
  add column if not exists purge_due_at timestamptz,
  add column if not exists file_purged_at timestamptz;

update public.customer_identity_verifications
set purge_due_at=coalesce(reviewed_at,updated_at,submitted_at,now())+interval '90 days'
where storage_path is not null
  and status in ('approved','rejected')
  and purge_due_at is null;

create table if not exists public.order_terms_acceptances (
  order_id uuid primary key references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now()
);

alter table public.order_terms_acceptances enable row level security;
drop policy if exists "terms acceptance customer or admin read" on public.order_terms_acceptances;
create policy "terms acceptance customer or admin read"
on public.order_terms_acceptances for select to authenticated
using(customer_id=(select auth.uid()) or private.is_admin());

grant select on public.order_terms_acceptances to authenticated;
revoke insert,update,delete on public.order_terms_acceptances from anon,authenticated;

create or replace function public.accept_order_terms(p_order_id uuid,p_terms_version text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'customer_login_required'; end if;
  if p_terms_version <> '2026-10-02' then raise exception 'terms_version_invalid'; end if;
  if not exists(
    select 1 from public.orders o
    where o.id=p_order_id and o.customer_id=auth.uid()
      and o.status='submitted' and o.assigned_agent_id is null
  ) then raise exception 'order_not_editable'; end if;

  insert into public.order_terms_acceptances(order_id,customer_id,terms_version,accepted_at)
  values(p_order_id,auth.uid(),p_terms_version,now())
  on conflict(order_id) do update
  set customer_id=excluded.customer_id,terms_version=excluded.terms_version,accepted_at=excluded.accepted_at;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_terms_accepted','order',p_order_id::text,
    jsonb_build_object('terms_version',p_terms_version));
end;
$$;

revoke execute on function public.accept_order_terms(uuid,text) from public,anon;
grant execute on function public.accept_order_terms(uuid,text) to authenticated;

create or replace function public.finalize_order_submission(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_status public.order_status;
  v_agent uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select status,assigned_agent_id into v_status,v_agent
  from public.orders
  where id=p_order_id and customer_id=auth.uid()
  for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status<>'submitted' or v_agent is not null then raise exception 'order_not_editable'; end if;

  if not exists(
    select 1 from public.order_terms_acceptances a
    where a.order_id=p_order_id and a.customer_id=auth.uid() and a.terms_version='2026-10-02'
  ) then raise exception 'terms_acceptance_required'; end if;

  if exists(
    select 1 from public.order_requirements
    where order_id=p_order_id and required=true and completed_at is null
  ) then raise exception 'requirements_incomplete'; end if;

  update public.orders set customer_submission_ready=true where id=p_order_id;
  perform public.try_dispatch_order(p_order_id);
end;
$$;

revoke execute on function public.finalize_order_submission(uuid) from public,anon;
grant execute on function public.finalize_order_submission(uuid) to authenticated;

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

  select coalesce((metadata->>'size')::bigint,(metadata->>'contentLength')::bigint),metadata->>'mimetype'
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
    submitted_at,reviewed_by,reviewed_at,updated_at,purge_due_at,file_purged_at
  ) values(
    auth.uid(),p_storage_path,trim(p_original_name),v_mime,v_size,'pending',null,
    now(),null,null,now(),null,null
  )
  on conflict(user_id) do update
  set storage_path=excluded.storage_path,original_name=excluded.original_name,
      mime_type=excluded.mime_type,file_size=excluded.file_size,status='pending',
      rejection_reason=null,submitted_at=now(),reviewed_by=null,reviewed_at=null,
      updated_at=now(),purge_due_at=null,file_purged_at=null
  returning * into v;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'customer_identity_submitted','customer',auth.uid()::text,
    jsonb_build_object('file_name',trim(p_original_name)));

  return v;
end;
$$;

revoke execute on function public.submit_customer_identity_document(text,text,text,bigint) from public,anon;
grant execute on function public.submit_customer_identity_document(text,text,text,bigint) to authenticated;

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
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now(),
      purge_due_at=now()+interval '90 days',file_purged_at=null
  where user_id=p_user_id;

  if not found then raise exception 'verification_not_found'; end if;

  insert into public.notifications(user_id,channel,title,body,sent_at)
  values(
    p_user_id,'in_app',
    case when p_status='approved' then 'تم التحقق من الهوية' else 'تعذر التحقق من الهوية' end,
    case when p_status='approved'
      then 'تم اعتماد هويتك ويمكنك الآن تقديم الطلبات.'
      else coalesce(nullif(trim(p_reason),''),'يرجى رفع إثبات هوية واضح وإعادة المحاولة.')
    end,now()
  );

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'customer_identity_reviewed','customer',p_user_id::text,
    jsonb_build_object('status',p_status,'reason',p_reason,'purge_due_at',now()+interval '90 days'));
end;
$$;

revoke execute on function public.admin_review_customer_identity(uuid,text,text) from public,anon;
grant execute on function public.admin_review_customer_identity(uuid,text,text) to authenticated;

create or replace function public.get_customer_id_purge_secret()
returns text language sql security definer set search_path=''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name='customer_id_purge_secret' limit 1
$$;

revoke execute on function public.get_customer_id_purge_secret() from public,anon,authenticated;
grant execute on function public.get_customer_id_purge_secret() to service_role;

create or replace function public.list_expired_customer_ids()
returns table(user_id uuid,storage_path text)
language sql security definer set search_path=''
as $$
  select v.user_id,v.storage_path
  from public.customer_identity_verifications v
  where v.storage_path is not null and v.file_purged_at is null
    and v.purge_due_at is not null and v.purge_due_at<=now()
$$;

revoke execute on function public.list_expired_customer_ids() from public,anon,authenticated;
grant execute on function public.list_expired_customer_ids() to service_role;

create or replace function public.mark_customer_id_purged(p_user_id uuid,p_storage_path text)
returns void
language plpgsql security definer set search_path=''
as $$
begin
  update public.customer_identity_verifications
  set storage_path=null,file_purged_at=now(),updated_at=now()
  where user_id=p_user_id and storage_path=p_storage_path and purge_due_at<=now();

  if found then
    insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
    values(null,'customer_identity_file_purged','customer',p_user_id::text,
      jsonb_build_object('purged_at',now()));
  end if;
end;
$$;

revoke execute on function public.mark_customer_id_purged(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_customer_id_purged(uuid,text) to service_role;
