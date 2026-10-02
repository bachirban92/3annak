do $$
declare r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname='public'
  loop
    execute format('revoke insert, update, delete on table public.%I from anon', r.tablename);
    execute format('revoke insert, update, delete on table public.%I from authenticated', r.tablename);
  end loop;
end $$;

grant update on table public.notifications to authenticated;
grant delete on table public.documents to authenticated;

create or replace function public.apply_as_agent()
returns public.agent_profiles
language plpgsql
security definer
set search_path=''
as $$
declare v_agent public.agent_profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'permanent_account_required';
  end if;
  if not exists(
    select 1 from public.profiles
    where id=auth.uid() and role='customer' and is_active=true
  ) then raise exception 'customer_account_required'; end if;

  update public.profiles
  set role='agent'
  where id=auth.uid() and role='customer' and is_active=true;

  insert into public.agent_profiles(user_id, verification_status, available)
  values(auth.uid(), 'pending', false)
  on conflict(user_id) do update set updated_at=now()
  returning * into v_agent;

  return v_agent;
end;
$$;

revoke execute on function public.apply_as_agent() from public,anon;
grant execute on function public.apply_as_agent() to authenticated;

create or replace function public.refresh_agent_dispatch()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'permanent_account_required';
  end if;
  if not exists(
    select 1 from public.agent_profiles
    where user_id=auth.uid() and verification_status='approved' and available=true
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select o.id,auth.uid(),'available'
  from public.orders o
  where o.status='submitted'
    and o.customer_submission_ready=true
    and o.assigned_agent_id is null
    and not exists(
      select 1 from public.order_requirements r
      where r.order_id=o.id and r.required=true and r.completed_at is null
    )
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid()
        and ac.active=true
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

revoke execute on function public.refresh_agent_dispatch() from public,anon;
grant execute on function public.refresh_agent_dispatch() to authenticated;
