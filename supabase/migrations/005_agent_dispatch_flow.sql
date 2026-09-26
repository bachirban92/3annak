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
        and lower(ac.governorate)=lower(new.governorate)
        and (ac.district is null or lower(ac.district)=lower(coalesce(new.district,'')))
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
        and lower(ac.governorate)=lower(new.governorate)
        and (ac.district is null or lower(ac.district)=lower(coalesce(new.district,'')))
    );

  return new;
end;
$$;

drop trigger if exists trg_dispatch_new_order on public.orders;
create trigger trg_dispatch_new_order
after insert on public.orders
for each row execute function public.dispatch_new_order();

revoke all on function public.dispatch_new_order() from public,anon,authenticated;

create or replace function public.get_agent_job(p_order_id uuid)
returns table(
  id uuid,
  public_code text,
  status public.order_status,
  governorate text,
  district text,
  cadastral_area text,
  property_number text,
  property_section text,
  customer_name text,
  customer_phone text,
  customer_email text,
  notes text,
  service_names text,
  agent_payout numeric,
  submitted_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select
    o.id,o.public_code,o.status,o.governorate,o.district,o.cadastral_area,
    o.property_number,o.property_section,o.customer_name,o.customer_phone,
    o.customer_email,o.notes,
    string_agg(oi.service_name_ar,'، ' order by oi.created_at),
    sum(oi.agent_payout),
    o.submitted_at,o.accepted_at
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  where o.id=p_order_id
    and (o.assigned_agent_id=auth.uid() or private.is_admin())
  group by o.id;
$$;

revoke execute on function public.get_agent_job(uuid) from public,anon;
grant execute on function public.get_agent_job(uuid) to authenticated;

create index if not exists idx_offers_order_status on public.dispatch_offers(order_id,status);
create index if not exists idx_offers_agent_status on public.dispatch_offers(agent_id,status,offered_at desc);
