create table if not exists public.agent_verification_requirements (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label_ar text not null,
  required boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_documents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_profiles(user_id) on delete cascade,
  requirement_id uuid not null references public.agent_verification_requirements(id) on delete restrict,
  storage_path text not null,
  original_name text,
  mime_type text,
  file_size bigint check(file_size is null or file_size >= 0),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_id,requirement_id)
);

drop trigger if exists agent_verification_requirements_set_updated_at on public.agent_verification_requirements;
create trigger agent_verification_requirements_set_updated_at
before update on public.agent_verification_requirements
for each row execute function public.set_updated_at();

drop trigger if exists agent_documents_set_updated_at on public.agent_documents;
create trigger agent_documents_set_updated_at
before update on public.agent_documents
for each row execute function public.set_updated_at();

alter table public.agent_verification_requirements enable row level security;
alter table public.agent_documents enable row level security;

drop policy if exists "agent requirements read" on public.agent_verification_requirements;
create policy "agent requirements read"
on public.agent_verification_requirements for select to authenticated
using(active or private.is_admin());

drop policy if exists "agent documents own or admin read" on public.agent_documents;
create policy "agent documents own or admin read"
on public.agent_documents for select to authenticated
using(agent_id=(select auth.uid()) or private.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('agent-files','agent-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update
set public=false,file_size_limit=10485760,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "agent files read" on storage.objects;
create policy "agent files read" on storage.objects for select to authenticated
using(bucket_id='agent-files' and ((storage.foldername(name))[1]=(select auth.uid())::text or private.is_admin()));

drop policy if exists "agent files insert" on storage.objects;
create policy "agent files insert" on storage.objects for insert to authenticated
with check(bucket_id='agent-files' and (storage.foldername(name))[1]=(select auth.uid())::text);

drop policy if exists "agent files update" on storage.objects;
create policy "agent files update" on storage.objects for update to authenticated
using(bucket_id='agent-files' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check(bucket_id='agent-files' and (storage.foldername(name))[1]=(select auth.uid())::text);

drop policy if exists "agent files delete" on storage.objects;
create policy "agent files delete" on storage.objects for delete to authenticated
using(bucket_id='agent-files' and (storage.foldername(name))[1]=(select auth.uid())::text);

insert into public.agent_verification_requirements(code,label_ar,required,active,sort_order)
values('identity_document','إثبات الهوية',true,true,10)
on conflict(code) do update
set label_ar=excluded.label_ar,required=excluded.required,active=excluded.active,sort_order=excluded.sort_order;

create or replace function public.submit_agent_document(
  p_requirement_id uuid,p_storage_path text,p_original_name text,p_mime_type text,p_file_size bigint
)
returns public.agent_documents
language plpgsql
security definer
set search_path=''
as $$
declare v public.agent_documents;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.agent_profiles where user_id=auth.uid()) then raise exception 'agent_profile_required'; end if;
  if not exists(select 1 from public.agent_verification_requirements where id=p_requirement_id and active=true) then raise exception 'invalid_requirement'; end if;
  if split_part(p_storage_path,'/',1) <> auth.uid()::text then raise exception 'invalid_storage_path'; end if;

  insert into public.agent_documents(agent_id,requirement_id,storage_path,original_name,mime_type,file_size,status,rejection_reason,reviewed_by,reviewed_at)
  values(auth.uid(),p_requirement_id,p_storage_path,p_original_name,p_mime_type,p_file_size,'pending',null,null,null)
  on conflict(agent_id,requirement_id) do update
  set storage_path=excluded.storage_path,original_name=excluded.original_name,mime_type=excluded.mime_type,file_size=excluded.file_size,
      status='pending',rejection_reason=null,reviewed_by=null,reviewed_at=null,updated_at=now()
  returning * into v;
  return v;
end;
$$;

create or replace function public.admin_review_agent_document(p_document_id uuid,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'invalid_status'; end if;
  update public.agent_documents
  set status=p_status,rejection_reason=case when p_status='rejected' then nullif(trim(p_reason),'') else null end,
      reviewed_by=auth.uid(),reviewed_at=now()
  where id=p_document_id;
  if not found then raise exception 'document_not_found'; end if;
end;
$$;

create or replace function public.admin_set_agent_status(p_agent_id uuid,p_status public.agent_verification_status)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status='approved' and exists(
    select 1 from public.agent_verification_requirements r
    where r.active=true and r.required=true
      and not exists(
        select 1 from public.agent_documents d
        where d.agent_id=p_agent_id and d.requirement_id=r.id and d.status='approved'
      )
  ) then raise exception 'agent_documents_incomplete'; end if;

  update public.agent_profiles
  set verification_status=p_status,
      approved_at=case when p_status='approved' then now() else approved_at end,
      available=case when p_status='approved' then available else false end
  where user_id=p_agent_id;
  if not found then raise exception 'agent_not_found'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'agent_status_changed','agent',p_agent_id::text,jsonb_build_object('status',p_status));
end;
$$;

revoke execute on function public.submit_agent_document(uuid,text,text,text,bigint) from public,anon;
revoke execute on function public.admin_review_agent_document(uuid,text,text) from public,anon;
grant execute on function public.submit_agent_document(uuid,text,text,text,bigint) to authenticated;
grant execute on function public.admin_review_agent_document(uuid,text,text) to authenticated;

create index if not exists idx_agent_documents_agent on public.agent_documents(agent_id,status);
create index if not exists idx_agent_documents_requirement on public.agent_documents(requirement_id);
