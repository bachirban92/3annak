alter table public.orders
  add column if not exists refund_pending boolean not null default false;

insert into public.app_settings(key,value)
values('payments_enforced','{"enabled":false}'::jsonb)
on conflict(key) do nothing;

create or replace function private.payments_enforced()
returns boolean
language sql stable security definer set search_path=''
as $$
  select coalesce(
    (select (value->>'enabled')::boolean from public.app_settings where key='payments_enforced'),
    false
  );
$$;

create or replace function private.ensure_order_payment()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.payments p where p.order_id=new.id) then
    insert into public.payments(order_id,amount,currency,status,metadata)
    values(new.id,new.total_amount,'USD','pending',jsonb_build_object('source','order_created'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_order_payment on public.orders;
create trigger trg_ensure_order_payment
after insert on public.orders
for each row execute function private.ensure_order_payment();

insert into public.payments(order_id,amount,currency,status,metadata)
select o.id,o.total_amount,'USD','pending',jsonb_build_object('source','backfill')
from public.orders o
where not exists(select 1 from public.payments p where p.order_id=o.id);

create or replace function public.admin_mark_payment_paid(
  p_payment_id uuid,p_provider text default 'manual',p_provider_reference text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare v_order_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  update public.payments
  set status='paid',
      provider=coalesce(nullif(trim(p_provider),''),'manual'),
      provider_reference=nullif(trim(p_provider_reference),''),
      paid_at=coalesce(paid_at,now()),
      refunded_at=null,
      updated_at=now()
  where id=p_payment_id and status in ('pending','failed')
  returning order_id into v_order_id;

  if v_order_id is null then raise exception 'payment_not_payable'; end if;

  update public.orders set refund_pending=false where id=v_order_id;
  perform public.try_dispatch_order(v_order_id);

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'payment_marked_paid','payment',p_payment_id::text,
         jsonb_build_object('order_id',v_order_id,'provider',p_provider,'reference',p_provider_reference));
end;
$$;

create or replace function public.admin_mark_payment_refunded(
  p_payment_id uuid,p_provider_reference text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare v_order_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  update public.payments
  set status='refunded',
      provider_reference=coalesce(nullif(trim(p_provider_reference),''),provider_reference),
      refunded_at=now(),
      updated_at=now()
  where id=p_payment_id and status in ('paid','partially_refunded')
  returning order_id into v_order_id;

  if v_order_id is null then raise exception 'payment_not_refundable'; end if;

  update public.orders set refund_pending=false where id=v_order_id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'payment_marked_refunded','payment',p_payment_id::text,
         jsonb_build_object('order_id',v_order_id,'reference',p_provider_reference));
end;
$$;

create or replace function public.cancel_own_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_paid boolean;
begin
  select exists(
    select 1 from public.payments p
    where p.order_id=p_order_id and p.status='paid'
  ) into v_paid;

  update public.orders
  set status='cancelled',
      cancelled_at=now(),
      refund_pending=v_paid
  where id=p_order_id
    and customer_id=auth.uid()
    and status='submitted'
    and assigned_agent_id is null;

  if not found then raise exception 'order_cannot_be_cancelled'; end if;

  update public.dispatch_offers
  set status='cancelled',responded_at=coalesce(responded_at,now())
  where order_id=p_order_id and status='available';

  insert into public.order_events(order_id,status,label_ar,note,created_by)
  values(
    p_order_id,'cancelled',public.order_status_label_ar('cancelled'),
    case when v_paid then 'رد المبلغ قيد المعالجة' else null end,
    auth.uid()
  );
end;
$$;

create or replace function public.try_dispatch_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders;
  v_count integer := 0;
begin
  select * into v_order from public.orders
  where id=p_order_id and status='submitted' and assigned_agent_id is null;

  if v_order.id is null then return 0; end if;

  if private.payments_enforced()
     and v_order.total_amount>0
     and not exists(select 1 from public.payments p where p.order_id=p_order_id and p.status='paid')
  then return 0; end if;

  if exists(
    select 1 from public.order_requirements r
    where r.order_id=p_order_id and r.required=true and r.completed_at is null
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select v_order.id,ap.user_id,'available'
  from public.agent_profiles ap
  where ap.verification_status='approved'
    and ap.available=true
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(v_order.governorate))
    )
  on conflict(order_id,agent_id) do nothing;

  get diagnostics v_count = row_count;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  select ap.user_id,v_order.id,'in_app','طلب جديد',
         'طلب جديد في '||v_order.cadastral_area||' — '||v_order.public_code,now()
  from public.agent_profiles ap
  where ap.verification_status='approved'
    and ap.available=true
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(v_order.governorate))
    )
    and not exists(
      select 1 from public.notifications n
      where n.user_id=ap.user_id and n.order_id=v_order.id and n.title='طلب جديد'
    );

  return v_count;
end;
$$;

create or replace function public.list_available_orders()
returns table(
  id uuid, public_code text, governorate text, district text, cadastral_area text,
  service_names text, agent_payout numeric, submitted_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select
    o.id,o.public_code,o.governorate,o.district,o.cadastral_area,
    string_agg(oi.service_name_ar,'، ' order by oi.created_at),
    sum(oi.agent_payout),o.submitted_at
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  join public.agent_profiles ap on ap.user_id=auth.uid()
  where o.status='submitted'
    and o.assigned_agent_id is null
    and ap.verification_status='approved'
    and ap.available=true
    and (not private.payments_enforced() or o.total_amount<=0 or exists(
      select 1 from public.payments p where p.order_id=o.id and p.status='paid'
    ))
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid() and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  group by o.id,o.public_code,o.governorate,o.district,o.cadastral_area,o.submitted_at
  order by o.submitted_at asc;
$$;

create or replace function public.refresh_agent_dispatch()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(
    select 1 from public.agent_profiles
    where user_id=auth.uid() and verification_status='approved' and available=true
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select o.id,auth.uid(),'available'
  from public.orders o
  where o.status='submitted'
    and o.assigned_agent_id is null
    and (not private.payments_enforced() or o.total_amount<=0 or exists(
      select 1 from public.payments p where p.order_id=o.id and p.status='paid'
    ))
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid() and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  on conflict(order_id,agent_id) do update
    set status=case
      when public.dispatch_offers.status in ('expired','declined','cancelled')
        then 'available'::public.offer_status
      else public.dispatch_offers.status
    end;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.accept_order(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders;
  v_payout numeric(10,2);
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  if not exists(
    select 1 from public.agent_profiles ap
    where ap.user_id=auth.uid() and ap.verification_status='approved' and ap.available=true
  ) then raise exception 'agent_not_eligible'; end if;

  update public.orders o
  set assigned_agent_id=auth.uid(),status='accepted',accepted_at=now()
  where o.id=p_order_id
    and o.status='submitted'
    and o.assigned_agent_id is null
    and (not private.payments_enforced() or o.total_amount<=0 or exists(
      select 1 from public.payments p where p.order_id=o.id and p.status='paid'
    ))
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid() and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  returning o.* into v_order;

  if v_order.id is null then raise exception 'order_unavailable'; end if;

  update public.dispatch_offers
  set status=case
      when agent_id=auth.uid() then 'accepted'::public.offer_status
      else 'cancelled'::public.offer_status
    end,
    responded_at=now()
  where order_id=p_order_id and status='available';

  insert into public.order_events(order_id,status,label_ar,created_by)
  values(p_order_id,'accepted',public.order_status_label_ar('accepted'),auth.uid());

  select coalesce(sum(agent_payout),0) into v_payout
  from public.order_items where order_id=p_order_id;

  insert into public.agent_ledger(agent_id,order_id,entry_type,amount,status,description)
  values(auth.uid(),p_order_id,'job_earning',v_payout,'pending','بدل تنفيذ الطلب');

  return v_order;
end;
$$;

revoke execute on function public.admin_mark_payment_paid(uuid,text,text) from public,anon;
revoke execute on function public.admin_mark_payment_refunded(uuid,text) from public,anon;
grant execute on function public.admin_mark_payment_paid(uuid,text,text) to authenticated;
grant execute on function public.admin_mark_payment_refunded(uuid,text) to authenticated;
