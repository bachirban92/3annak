-- Production operations: notifications, expenses, ratings, disputes, admin controls

create or replace function public.create_order_notification()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_customer uuid;
  v_agent uuid;
begin
  select customer_id, assigned_agent_id into v_customer, v_agent
  from public.orders where id=new.order_id;

  if new.visible_to_customer and v_customer is not null then
    insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
    values(v_customer,new.order_id,'in_app','تحديث على طلبك',new.label_ar,now());
  end if;

  if v_agent is not null and new.created_by is distinct from v_agent then
    insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
    values(v_agent,new.order_id,'in_app','تحديث على الطلب',new.label_ar,now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_event_notification on public.order_events;
create trigger trg_order_event_notification
after insert on public.order_events
for each row execute function public.create_order_notification();

revoke all on function public.create_order_notification() from public,anon,authenticated;

create or replace function public.submit_expense(
  p_order_id uuid,
  p_category text,
  p_amount numeric,
  p_currency text default 'USD',
  p_receipt_document_id uuid default null
)
returns public.order_expenses
language plpgsql
security definer
set search_path=''
as $$
declare v_expense public.order_expenses;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_amount < 0 then raise exception 'invalid_amount'; end if;
  if not exists(select 1 from public.orders where id=p_order_id and assigned_agent_id=auth.uid()) then
    raise exception 'not_assigned_agent';
  end if;
  insert into public.order_expenses(order_id,agent_id,category,amount,currency,receipt_document_id)
  values(p_order_id,auth.uid(),trim(p_category),p_amount,upper(p_currency),p_receipt_document_id)
  returning * into v_expense;
  return v_expense;
end;
$$;

create or replace function public.admin_review_expense(
  p_expense_id uuid,
  p_status public.expense_status
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_exp public.order_expenses;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('approved','rejected','reimbursed') then raise exception 'invalid_status'; end if;

  update public.order_expenses
  set status=p_status,reviewed_at=now(),reviewed_by=auth.uid()
  where id=p_expense_id
  returning * into v_exp;

  if v_exp.id is null then raise exception 'expense_not_found'; end if;

  if p_status='approved' and not exists(
    select 1 from public.agent_ledger
    where agent_id=v_exp.agent_id and order_id=v_exp.order_id
      and entry_type='expense_reimbursement'
      and description=('expense:'||v_exp.id::text)
  ) then
    insert into public.agent_ledger(agent_id,order_id,entry_type,amount,currency,status,description,available_at)
    values(v_exp.agent_id,v_exp.order_id,'expense_reimbursement',v_exp.amount,v_exp.currency,'available','expense:'||v_exp.id::text,now());
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'expense_reviewed','expense',v_exp.id::text,jsonb_build_object('status',p_status));
end;
$$;

create or replace function public.submit_rating(
  p_order_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.ratings
language plpgsql
security definer
set search_path=''
as $$
declare
  v_agent uuid;
  v_rating public.ratings;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid_rating'; end if;

  select assigned_agent_id into v_agent
  from public.orders
  where id=p_order_id and customer_id=auth.uid() and status='completed';

  if v_agent is null then raise exception 'order_not_rateable'; end if;

  insert into public.ratings(order_id,customer_id,agent_id,rating,comment)
  values(p_order_id,auth.uid(),v_agent,p_rating,nullif(trim(p_comment),''))
  returning * into v_rating;

  update public.agent_profiles ap
  set rating=(select round(avg(r.rating)::numeric,1) from public.ratings r where r.agent_id=v_agent)
  where ap.user_id=v_agent;

  return v_rating;
end;
$$;

create or replace function public.open_dispute(
  p_order_id uuid,
  p_reason text
)
returns public.disputes
language plpgsql
security definer
set search_path=''
as $$
declare v_dispute public.disputes;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(
    select 1 from public.orders
    where id=p_order_id and (customer_id=auth.uid() or assigned_agent_id=auth.uid())
  ) then raise exception 'not_authorized'; end if;

  insert into public.disputes(order_id,opened_by,reason)
  values(p_order_id,auth.uid(),trim(p_reason))
  returning * into v_dispute;

  return v_dispute;
end;
$$;

create or replace function public.admin_update_order(
  p_order_id uuid,
  p_status public.order_status,
  p_official_fees numeric default null,
  p_total_amount numeric default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  update public.orders
  set status=p_status,
      official_fees=coalesce(p_official_fees,official_fees),
      total_amount=coalesce(p_total_amount,total_amount),
      completed_at=case when p_status='completed' then coalesce(completed_at,now()) else completed_at end,
      cancelled_at=case when p_status='cancelled' then coalesce(cancelled_at,now()) else cancelled_at end
  where id=p_order_id;

  if not found then raise exception 'order_not_found'; end if;

  insert into public.order_events(order_id,status,label_ar,note,visible_to_customer,created_by)
  values(p_order_id,p_status,public.order_status_label_ar(p_status),nullif(trim(p_note),''),true,auth.uid());

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'order_admin_updated','order',p_order_id::text,
         jsonb_build_object('status',p_status,'official_fees',p_official_fees,'total_amount',p_total_amount));
end;
$$;

create or replace function public.create_payout_batch(
  p_agent_id uuid,
  p_currency text default 'USD'
)
returns public.payouts
language plpgsql
security definer
set search_path=''
as $$
declare
  v_amount numeric(10,2);
  v_payout public.payouts;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;

  select coalesce(sum(amount),0) into v_amount
  from public.agent_ledger
  where agent_id=p_agent_id and currency=upper(p_currency) and status='available';

  if v_amount <= 0 then raise exception 'no_available_balance'; end if;

  insert into public.payouts(agent_id,amount,currency,status,period_start,period_end)
  values(p_agent_id,v_amount,upper(p_currency),'pending',current_date-7,current_date)
  returning * into v_payout;

  update public.agent_ledger
  set status='paid',paid_at=now()
  where agent_id=p_agent_id and currency=upper(p_currency) and status='available';

  insert into public.agent_ledger(agent_id,entry_type,amount,currency,status,description,paid_at)
  values(p_agent_id,'payout',-v_amount,upper(p_currency),'paid','payout:'||v_payout.id::text,now());

  return v_payout;
end;
$$;

revoke execute on function public.submit_expense(uuid,text,numeric,text,uuid) from public,anon;
revoke execute on function public.admin_review_expense(uuid,public.expense_status) from public,anon;
revoke execute on function public.submit_rating(uuid,integer,text) from public,anon;
revoke execute on function public.open_dispute(uuid,text) from public,anon;
revoke execute on function public.admin_update_order(uuid,public.order_status,numeric,numeric,text) from public,anon;
revoke execute on function public.create_payout_batch(uuid,text) from public,anon;

grant execute on function public.submit_expense(uuid,text,numeric,text,uuid) to authenticated;
grant execute on function public.admin_review_expense(uuid,public.expense_status) to authenticated;
grant execute on function public.submit_rating(uuid,integer,text) to authenticated;
grant execute on function public.open_dispute(uuid,text) to authenticated;
grant execute on function public.admin_update_order(uuid,public.order_status,numeric,numeric,text) to authenticated;
grant execute on function public.create_payout_batch(uuid,text) to authenticated;

create index if not exists idx_audit_actor on public.audit_log(actor_id);
create index if not exists idx_disputes_opened_by on public.disputes(opened_by);
create index if not exists idx_documents_uploaded_by on public.documents(uploaded_by);
create index if not exists idx_events_created_by on public.order_events(created_by);
create index if not exists idx_expenses_receipt on public.order_expenses(receipt_document_id);
