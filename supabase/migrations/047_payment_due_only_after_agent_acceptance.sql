create or replace function public.admin_mark_payment_paid(
  p_payment_id uuid,
  p_provider text default 'cash',
  p_provider_reference text default null
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select p.order_id into v_order_id
  from public.payments p
  join public.orders o on o.id=p.order_id
  where p.id=p_payment_id
    and p.status in ('pending','failed')
    and o.assigned_agent_id is not null
    and o.status not in ('cancelled','completed')
  for update of p,o;

  if v_order_id is null then raise exception 'payment_not_due'; end if;

  update public.payments
  set status='paid',
      provider=coalesce(nullif(trim(p_provider),''),'cash'),
      provider_reference=nullif(trim(p_provider_reference),''),
      paid_at=coalesce(paid_at,now()),
      refunded_at=null,
      updated_at=now()
  where id=p_payment_id;

  update public.orders set refund_pending=false where id=v_order_id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),'payment_marked_paid','payment',p_payment_id::text,
    jsonb_build_object(
      'order_id',v_order_id,
      'provider',coalesce(nullif(trim(p_provider),''),'cash'),
      'reference',p_provider_reference
    )
  );
end;
$$;
