-- Payout account verification is admin-controlled only.
drop policy if exists "agent payout account own" on public.agent_payout_accounts;

create policy "agent payout account own read"
on public.agent_payout_accounts
for select
to authenticated
using (user_id=auth.uid() or private.is_admin());

-- Agents save payout details only through save_agent_payout_account(), which
-- always resets is_verified=false. Admin verification uses a separate RPC.

-- Enforce storage limits at the bucket boundary as well as in registration RPCs.
update storage.buckets
set file_size_limit=10*1024*1024,
    allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp']::text[]
where id='order-files';

-- Only actual agent accounts may write to agent-files.
drop policy if exists "agent files insert" on storage.objects;
create policy "agent files insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='agent-files'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.agent_profiles ap where ap.user_id=auth.uid())
);

drop policy if exists "agent files update" on storage.objects;
create policy "agent files update"
on storage.objects
for update
to authenticated
using (
  bucket_id='agent-files'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.agent_profiles ap where ap.user_id=auth.uid())
)
with check (
  bucket_id='agent-files'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.agent_profiles ap where ap.user_id=auth.uid())
);

drop policy if exists "agent files delete" on storage.objects;
create policy "agent files delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id='agent-files'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.agent_profiles ap where ap.user_id=auth.uid())
);

-- Internal dispatch helper should not be directly exposed as an RPC.
revoke execute on function public.try_dispatch_order(uuid) from public, anon, authenticated;
