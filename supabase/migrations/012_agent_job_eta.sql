drop function if exists public.get_agent_job(uuid);

create function public.get_agent_job(p_order_id uuid)
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
  accepted_at timestamptz,
  expected_ready_at timestamptz
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
    o.submitted_at,o.accepted_at,o.expected_ready_at
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  where o.id=p_order_id
    and (o.assigned_agent_id=auth.uid() or private.is_admin())
  group by o.id;
$$;

revoke execute on function public.get_agent_job(uuid) from public,anon;
grant execute on function public.get_agent_job(uuid) to authenticated;
