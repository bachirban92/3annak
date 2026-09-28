-- Prevent duplicate hard-copy delivery confirmations.
create or replace function public.confirm_hard_copy_delivery(
  p_order_id uuid,
  p_note text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare
  v_status public.order_status;
begin
  select status into v_status
  from public.orders
  where id=p_order_id
    and assigned_agent_id=auth.uid()
    and delivery_mode='hard_copy'
    and hard_copy_delivered_at is null
  for update;

  if v_status is null or v_status in ('cancelled','completed') then
    raise exception 'delivery_not_available';
  end if;

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
end $$;
