create or replace function public.set_expected_ready_on_accept()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_total integer;
  v_with_eta integer;
  v_days integer;
begin
  if new.status='accepted' and old.status is distinct from 'accepted' then
    select
      count(*),
      count(*) filter (where coalesce(s.expected_days_max,s.expected_days_min) is not null),
      max(coalesce(s.expected_days_max,s.expected_days_min))
    into v_total,v_with_eta,v_days
    from public.order_deliverables od
    join public.services s on s.id=od.service_id
    where od.order_id=new.id;

    if v_total>0 and v_with_eta=v_total and v_days is not null then
      new.expected_ready_at := now() + make_interval(days=>v_days);
    else
      new.expected_ready_at := null;
    end if;
  end if;
  return new;
end;
$function$;
