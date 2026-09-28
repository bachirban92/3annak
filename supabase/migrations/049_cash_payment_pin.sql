create table if not exists private.cash_payment_pins (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  pin_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  generated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by_agent uuid references auth.users(id)
);

revoke all on table private.cash_payment_pins from public, anon, authenticated;

create or replace function public.customer_generate_cash_payment_pin(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment_id uuid;
  v_pin text;
  v_bytes bytea;
  v_number bigint;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select p.id into v_payment_id
  from public.orders o
  join public.payments p on p.order_id=o.id
  where o.id=p_order_id
    and o.customer_id=auth.uid()
    and o.assigned_agent_id is not null
    and o.status not in ('completed','cancelled')
    and p.status in ('pending','failed')
  order by p.created_at desc
  limit 1
  for update of p;

  if v_payment_id is null then raise exception 'cash_payment_not_available'; end if;

  if exists(select 1 from public.order_workflow_steps where order_id=p_order_id and completed_at is null)
     or exists(
       select 1 from public.order_deliverables od
       where od.order_id=p_order_id
         and not exists(
           select 1 from public.documents d
           where d.order_id=p_order_id and d.deliverable_id=od.id and d.kind='final_document'
         )
     )
  then raise exception 'work_not_ready'; end if;

  v_bytes := extensions.gen_random_bytes(4);
  v_number := (
    get_byte(v_bytes,0)::bigint * 16777216
    + get_byte(v_bytes,1)::bigint * 65536
    + get_byte(v_bytes,2)::bigint * 256
    + get_byte(v_bytes,3)::bigint
  ) % 1000000;
  v_pin := lpad(v_number::text,6,'0');

  insert into private.cash_payment_pins(payment_id,pin_hash,attempts,generated_at,confirmed_at,confirmed_by_agent)
  values(v_payment_id,extensions.crypt(v_pin,extensions.gen_salt('bf')),0,now(),null,null)
  on conflict(payment_id) do update
  set pin_hash=excluded.pin_hash,attempts=0,generated_at=now(),confirmed_at=null,confirmed_by_agent=null;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'cash_payment_pin_generated','payment',v_payment_id::text,jsonb_build_object('order_id',p_order_id));

  return v_pin;
end;
$$;

revoke execute on function public.customer_generate_cash_payment_pin(uuid) from public, anon;
grant execute on function public.customer_generate_cash_payment_pin(uuid) to authenticated;

create or replace function public.agent_confirm_cash_payment(p_order_id uuid,p_pin text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.payments;
  v_pin private.cash_payment_pins;
  v_customer uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then return 'invalid_cash_pin'; end if;

  select p.* into v_payment
  from public.payments p
  join public.orders o on o.id=p.order_id
  where p.order_id=p_order_id
    and o.assigned_agent_id=auth.uid()
    and o.status not in ('completed','cancelled')
    and p.status in ('pending','failed')
  order by p.created_at desc
  limit 1
  for update of p;

  if v_payment.id is null then raise exception 'cash_payment_not_available'; end if;

  if exists(select 1 from public.order_workflow_steps where order_id=p_order_id and completed_at is null)
     or exists(
       select 1 from public.order_deliverables od
       where od.order_id=p_order_id
         and not exists(
           select 1 from public.documents d
           where d.order_id=p_order_id and d.deliverable_id=od.id and d.kind='final_document'
         )
     )
  then raise exception 'work_not_ready'; end if;

  select * into v_pin
  from private.cash_payment_pins
  where payment_id=v_payment.id
  for update;

  if v_pin.payment_id is null then return 'cash_pin_not_generated'; end if;
  if v_pin.confirmed_at is not null then return 'cash_pin_already_used'; end if;
  if v_pin.attempts >= 5 then return 'cash_pin_locked'; end if;

  if extensions.crypt(p_pin,v_pin.pin_hash) <> v_pin.pin_hash then
    update private.cash_payment_pins set attempts=attempts+1 where payment_id=v_payment.id;
    if v_pin.attempts+1 >= 5 then return 'cash_pin_locked'; end if;
    return 'invalid_cash_pin';
  end if;

  update public.payments
  set status='paid',provider='cash',provider_reference='cash-pin',
      paid_at=coalesce(paid_at,now()),refunded_at=null,updated_at=now()
  where id=v_payment.id;

  update private.cash_payment_pins
  set confirmed_at=now(),confirmed_by_agent=auth.uid()
  where payment_id=v_payment.id;

  update public.orders set refund_pending=false where id=p_order_id;
  select customer_id into v_customer from public.orders where id=p_order_id;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  values(v_customer,p_order_id,'in_app','تم تأكيد الدفع النقدي','تم تأكيد استلام المبلغ النقدي من قبل الوكيل.',now());

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  select id,status,'تم تأكيد الدفع النقدي',null,true,auth.uid()
  from public.orders where id=p_order_id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'cash_payment_confirmed','payment',v_payment.id::text,
    jsonb_build_object('order_id',p_order_id,'amount',v_payment.amount,'method','customer_pin'));

  return 'paid';
end;
$$;

revoke execute on function public.agent_confirm_cash_payment(uuid,text) from public, anon;
grant execute on function public.agent_confirm_cash_payment(uuid,text) to authenticated;
