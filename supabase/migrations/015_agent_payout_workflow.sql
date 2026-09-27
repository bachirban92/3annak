alter table public.agent_ledger
  add column if not exists payout_id uuid references public.payouts(id) on delete set null;

create index if not exists idx_agent_ledger_payout_id on public.agent_ledger(payout_id);

create or replace function public.get_agent_balance()
returns table(pending numeric, available numeric, paid numeric)
language sql stable security definer set search_path='' as $$
  select
    coalesce(sum(amount) filter (where status='pending'),0),
    coalesce(sum(amount) filter (where status='available' and payout_id is null),0),
    coalesce(sum(amount) filter (where status='paid'),0)
  from public.agent_ledger
  where agent_id=auth.uid() and entry_type <> 'payout';
$$;

create or replace function public.get_agent_earnings_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if not exists(select 1 from public.agent_profiles where user_id=auth.uid()) then raise exception 'agent_profile_required'; end if;
  select jsonb_build_object(
    'pending',coalesce(sum(amount) filter(where status='pending' and entry_type<>'payout'),0),
    'available',coalesce(sum(amount) filter(where status='available' and payout_id is null and entry_type<>'payout'),0),
    'paid',coalesce(sum(amount) filter(where status='paid' and entry_type<>'payout'),0),
    'completed_jobs',(select completed_orders from public.agent_profiles where user_id=auth.uid())
  ) into v
  from public.agent_ledger where agent_id=auth.uid();
  return v;
end;
$$;

create or replace function public.create_payout_batch(p_agent_id uuid,p_currency text default 'USD')
returns public.payouts language plpgsql security definer set search_path='' as $$
declare v_amount numeric(10,2); v_payout public.payouts;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  select coalesce(sum(amount),0) into v_amount
  from public.agent_ledger
  where agent_id=p_agent_id and currency=upper(p_currency) and status='available'
    and entry_type<>'payout' and payout_id is null;
  if v_amount <= 0 then raise exception 'no_available_balance'; end if;

  insert into public.payouts(agent_id,amount,currency,status,period_start,period_end)
  values(p_agent_id,v_amount,upper(p_currency),'pending',current_date-7,current_date)
  returning * into v_payout;

  update public.agent_ledger set payout_id=v_payout.id
  where agent_id=p_agent_id and currency=upper(p_currency) and status='available'
    and entry_type<>'payout' and payout_id is null;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'payout_created','payout',v_payout.id::text,
    jsonb_build_object('agent_id',p_agent_id,'amount',v_amount,'currency',upper(p_currency)));

  return v_payout;
end;
$$;

create or replace function public.admin_mark_payout_paid(p_payout_id uuid,p_provider text default null,p_reference text default null)
returns public.payouts language plpgsql security definer set search_path='' as $$
declare v public.payouts;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  update public.payouts
  set status='paid',provider=nullif(trim(p_provider),''),provider_reference=nullif(trim(p_reference),''),
      paid_at=coalesce(paid_at,now())
  where id=p_payout_id and status='pending'
  returning * into v;
  if v.id is null then raise exception 'payout_not_pending'; end if;

  update public.agent_ledger set status='paid',paid_at=coalesce(paid_at,now())
  where payout_id=v.id and status='available';

  if not exists(
    select 1 from public.agent_ledger
    where agent_id=v.agent_id and entry_type='payout' and description='payout:'||v.id::text
  ) then
    insert into public.agent_ledger(agent_id,entry_type,amount,currency,status,description,paid_at,payout_id)
    values(v.agent_id,'payout',-v.amount,v.currency,'paid','payout:'||v.id::text,now(),v.id);
  end if;

  insert into public.notifications(user_id,channel,title,body)
  values(v.agent_id,'in_app','تم تحويل الدفعة','تم تسجيل دفعة بقيمة '||v.amount||' '||v.currency);

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'payout_paid','payout',v.id::text,jsonb_build_object('provider',p_provider,'reference',p_reference));
  return v;
end;
$$;

create or replace function public.admin_cancel_payout(p_payout_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.payouts;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  update public.payouts set status='void' where id=p_payout_id and status='pending' returning * into v;
  if v.id is null then raise exception 'payout_not_pending'; end if;

  update public.agent_ledger set payout_id=null
  where payout_id=v.id and status='available' and entry_type<>'payout';

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'payout_cancelled','payout',v.id::text,'{}'::jsonb);
end;
$$;

revoke execute on function public.admin_mark_payout_paid(uuid,text,text) from public,anon;
revoke execute on function public.admin_cancel_payout(uuid) from public,anon;
grant execute on function public.admin_mark_payout_paid(uuid,text,text) to authenticated;
grant execute on function public.admin_cancel_payout(uuid) to authenticated;
