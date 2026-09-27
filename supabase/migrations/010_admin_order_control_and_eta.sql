alter table public.orders
  add column if not exists expected_ready_at timestamptz;

create table if not exists public.order_assignment_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_agent_id uuid references public.agent_profiles(user_id) on delete set null,
  to_agent_id uuid references public.agent_profiles(user_id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.order_assignment_history enable row level security;

create policy "assignment history admin read"
on public.order_assignment_history for select to authenticated
using (private.is_admin());

create index if not exists idx_assignment_history_order
on public.order_assignment_history(order_id,created_at desc);

create or replace function public.set_expected_ready_on_accept()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_days integer;
begin
  if new.status='accepted' and old.status is distinct from 'accepted' then
    select max(coalesce(s.expected_days_max,s.expected_days_min,3))
    into v_days
    from public.order_items oi
    join public.services s on s.id=oi.service_id
    where oi.order_id=new.id;
    new.expected_ready_at := now() + make_interval(days => coalesce(v_days,3));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_expected_ready_on_accept on public.orders;
create trigger trg_set_expected_ready_on_accept
before update of status on public.orders
for each row execute function public.set_expected_ready_on_accept();

revoke all on function public.set_expected_ready_on_accept() from public,anon,authenticated;

create or replace function public.admin_reassign_order(p_order_id uuid,p_agent_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_old_agent uuid; v_status public.order_status;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.agent_profiles where user_id=p_agent_id and verification_status='approved')
    then raise exception 'agent_not_approved'; end if;

  select assigned_agent_id,status into v_old_agent,v_status
  from public.orders where id=p_order_id for update;

  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status in ('completed','cancelled') then raise exception 'order_closed'; end if;

  update public.orders
  set assigned_agent_id=p_agent_id,status='accepted',accepted_at=coalesce(accepted_at,now())
  where id=p_order_id;

  insert into public.order_assignment_history(order_id,from_agent_id,to_agent_id,changed_by,reason)
  values(p_order_id,v_old_agent,p_agent_id,auth.uid(),nullif(trim(p_reason),''));

  update public.dispatch_offers
  set status=case when agent_id=p_agent_id then 'accepted'::public.offer_status else 'cancelled'::public.offer_status end,
      responded_at=now()
  where order_id=p_order_id and status='available';

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(p_order_id,'accepted','تم تعيين وكيل للطلب',nullif(trim(p_reason),''),true,auth.uid());

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  values(p_agent_id,p_order_id,'in_app','تم تعيين طلب لك','تم تعيين طلب جديد لك من الإدارة',now());

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_reassigned','order',p_order_id::text,
    jsonb_build_object('from_agent',v_old_agent,'to_agent',p_agent_id,'reason',p_reason));
end;
$$;

create or replace function public.admin_cancel_order(p_order_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  update public.orders set status='cancelled',cancelled_at=now()
  where id=p_order_id and status not in ('completed','cancelled');
  if not found then raise exception 'order_not_cancellable'; end if;

  update public.agent_ledger set status='void'
  where order_id=p_order_id and status in ('pending','available');

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(p_order_id,'cancelled','تم إلغاء الطلب',nullif(trim(p_reason),''),true,auth.uid());

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_cancelled','order',p_order_id::text,jsonb_build_object('reason',p_reason));
end;
$$;

create or replace function public.admin_get_order(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  select jsonb_build_object(
    'order',to_jsonb(o),
    'items',coalesce((select jsonb_agg(to_jsonb(oi) order by oi.created_at) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.order_events e where e.order_id=o.id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.documents d where d.order_id=o.id),'[]'::jsonb),
    'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.order_requirements r where r.order_id=o.id),'[]'::jsonb),
    'assignment_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from public.order_assignment_history h where h.order_id=o.id),'[]'::jsonb)
  ) into v_result
  from public.orders o where o.id=p_order_id;
  if v_result is null then raise exception 'order_not_found'; end if;
  return v_result;
end;
$$;

revoke execute on function public.admin_reassign_order(uuid,uuid,text) from public,anon;
revoke execute on function public.admin_cancel_order(uuid,text) from public,anon;
revoke execute on function public.admin_get_order(uuid) from public,anon;
grant execute on function public.admin_reassign_order(uuid,uuid,text) to authenticated;
grant execute on function public.admin_cancel_order(uuid,text) to authenticated;
grant execute on function public.admin_get_order(uuid) to authenticated;
