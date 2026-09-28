create or replace function public.admin_set_agent_payout_account_verified(
  p_agent_id uuid,
  p_verified boolean
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  update public.agent_payout_accounts
  set is_verified=p_verified,updated_at=now()
  where user_id=p_agent_id;

  if not found then raise exception 'payout_account_not_found'; end if;

  insert into public.notifications(user_id,channel,title,body,sent_at)
  values(
    p_agent_id,
    'in_app',
    case when p_verified then 'تم اعتماد حساب التحويل' else 'حساب التحويل يحتاج مراجعة' end,
    case when p_verified
      then 'تم اعتماد بيانات التحويل ويمكن للإدارة إنشاء دفعة عند توفر رصيد.'
      else 'راجع بيانات الحساب البنكي ثم احفظها من جديد.'
    end,
    now()
  );

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),
    'agent_payout_account_verification_changed',
    'agent',
    p_agent_id::text,
    jsonb_build_object('verified',p_verified)
  );
end;
$$;

create or replace function public.create_payout_batch(
  p_agent_id uuid,
  p_currency text default 'USD'
) returns public.payouts
language plpgsql
security definer
set search_path=''
as $$
declare
  v_amount numeric(10,2);
  v_payout public.payouts;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  if not exists(
    select 1 from public.agent_payout_accounts
    where user_id=p_agent_id
  ) then raise exception 'payout_account_required'; end if;

  if not exists(
    select 1 from public.agent_payout_accounts
    where user_id=p_agent_id and is_verified=true
  ) then raise exception 'payout_account_not_verified'; end if;

  select coalesce(sum(amount),0)
  into v_amount
  from public.agent_ledger
  where agent_id=p_agent_id
    and currency=upper(p_currency)
    and status='available'
    and entry_type<>'payout'
    and payout_id is null;

  if v_amount <= 0 then raise exception 'no_available_balance'; end if;

  insert into public.payouts(agent_id,amount,currency,status,period_start,period_end)
  values(p_agent_id,v_amount,upper(p_currency),'pending',current_date-7,current_date)
  returning * into v_payout;

  update public.agent_ledger
  set payout_id=v_payout.id
  where agent_id=p_agent_id
    and currency=upper(p_currency)
    and status='available'
    and entry_type<>'payout'
    and payout_id is null;

  insert into public.notifications(user_id,channel,title,body,sent_at)
  values(
    p_agent_id,
    'in_app',
    'تم إنشاء دفعة',
    'تم تجهيز دفعة بقيمة '||v_amount||' '||upper(p_currency)||' وهي بانتظار التحويل.',
    now()
  );

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),'payout_created','payout',v_payout.id::text,
    jsonb_build_object('agent_id',p_agent_id,'amount',v_amount,'currency',upper(p_currency))
  );

  return v_payout;
end;
$$;
