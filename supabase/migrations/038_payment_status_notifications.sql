create or replace function public.notify_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_customer uuid;
  v_code text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status not in ('paid','failed','refunded','partially_refunded') then
    return new;
  end if;

  select customer_id,public_code into v_customer,v_code
  from public.orders
  where id=new.order_id;

  if v_customer is null then
    return new;
  end if;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  values(
    v_customer,
    new.order_id,
    'in_app',
    case
      when new.status='paid' then 'تم تأكيد الدفع'
      when new.status='failed' then 'تعذر إتمام الدفع'
      when new.status='refunded' then 'تم رد المبلغ'
      else 'تم رد جزء من المبلغ'
    end,
    case
      when new.status='paid' then 'تم تسجيل دفع الطلب '||coalesce(v_code,'')
      when new.status='failed' then 'تعذر تسجيل دفع الطلب '||coalesce(v_code,'')
      when new.status='refunded' then 'تم تسجيل رد مبلغ الطلب '||coalesce(v_code,'')
      else 'تم تسجيل رد جزئي لمبلغ الطلب '||coalesce(v_code,'')
    end,
    now()
  );

  return new;
end;
$$;

drop trigger if exists trg_payment_status_notification on public.payments;
create trigger trg_payment_status_notification
after update of status on public.payments
for each row
when (old.status is distinct from new.status)
execute function public.notify_payment_status_change();
