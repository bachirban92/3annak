drop policy if exists "disputes parties read" on public.disputes;
create policy "disputes parties read"
on public.disputes for select to authenticated
using(
  opened_by=(select auth.uid())
  or exists(select 1 from public.orders o where o.id=order_id and o.assigned_agent_id=(select auth.uid()))
  or private.is_admin()
);

create or replace function public.admin_update_dispute(p_dispute_id uuid,p_status text,p_resolution text default null)
returns public.disputes language plpgsql security definer set search_path='' as $$
declare v public.disputes;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('reviewing','resolved','closed') then raise exception 'invalid_status'; end if;
  if p_status in ('resolved','closed') and length(trim(coalesce(p_resolution,''))) < 2 then
    raise exception 'resolution_required';
  end if;

  update public.disputes
  set status=p_status,
      resolution=case when p_status in ('resolved','closed') then trim(p_resolution) else resolution end,
      resolved_at=case when p_status in ('resolved','closed') then now() else null end,
      resolved_by=case when p_status in ('resolved','closed') then auth.uid() else null end
  where id=p_dispute_id
  returning * into v;

  if v.id is null then raise exception 'dispute_not_found'; end if;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  values(
    v.opened_by,v.order_id,'in_app',
    case when p_status='reviewing' then 'طلب الدعم قيد المراجعة' else 'تم تحديث طلب الدعم' end,
    case when p_status='reviewing' then 'نراجع طلب الدعم الخاص بك.'
         else coalesce(nullif(trim(p_resolution),''),'تم إغلاق طلب الدعم.') end,
    now()
  );

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'dispute_updated','dispute',v.id::text,jsonb_build_object('status',p_status,'resolution',p_resolution));

  return v;
end;
$$;

revoke execute on function public.admin_update_dispute(uuid,text,text) from public,anon;
grant execute on function public.admin_update_dispute(uuid,text,text) to authenticated;
