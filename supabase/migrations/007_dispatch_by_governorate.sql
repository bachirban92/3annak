create or replace function public.dispatch_new_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.dispatch_offers(order_id, agent_id, status)
  select new.id, ap.user_id, 'available'
  from public.agent_profiles ap
  where ap.verification_status='approved'
    and ap.available=true
    and exists (
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(new.governorate))
    )
  on conflict(order_id,agent_id) do nothing;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  select ap.user_id,new.id,'in_app','طلب جديد',
         'طلب جديد في '||new.cadastral_area||' — '||new.public_code,now()
  from public.agent_profiles ap
  where ap.verification_status='approved'
    and ap.available=true
    and exists (
      select 1 from public.agent_coverage ac
      where ac.agent_id=ap.user_id
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(new.governorate))
    );

  return new;
end;
$$;

create or replace function public.refresh_agent_dispatch()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  if not exists(
    select 1 from public.agent_profiles
    where user_id=auth.uid()
      and verification_status='approved'
      and available=true
  ) then return 0; end if;

  insert into public.dispatch_offers(order_id,agent_id,status)
  select o.id,auth.uid(),'available'
  from public.orders o
  where o.status='submitted'
    and o.assigned_agent_id is null
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

create or replace function public.list_available_orders()
returns table(
  id uuid,
  public_code text,
  governorate text,
  district text,
  cadastral_area text,
  service_names text,
  agent_payout numeric,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
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
    and exists(
      select 1 from public.agent_coverage ac
      where ac.agent_id=auth.uid()
        and ac.active=true
        and lower(trim(ac.governorate))=lower(trim(o.governorate))
    )
  group by o.id,o.public_code,o.governorate,o.district,o.cadastral_area,o.submitted_at
  order by o.submitted_at asc;
$$;
