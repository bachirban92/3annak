do $$
begin
  alter publication supabase_realtime add table public.order_events;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.dispatch_offers;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

create or replace function public.get_agent_balance()
returns table(pending numeric, available numeric, paid numeric)
language sql
stable
security definer
set search_path=''
as $$
  select
    coalesce(sum(amount) filter (where status='pending'),0),
    coalesce(sum(amount) filter (where status='available'),0),
    coalesce(sum(amount) filter (where status='paid'),0)
  from public.agent_ledger
  where agent_id=auth.uid() and entry_type <> 'payout';
$$;

revoke execute on function public.get_agent_balance() from public,anon;
grant execute on function public.get_agent_balance() to authenticated;
