drop policy if exists "payments customer read" on public.payments;
drop policy if exists "payments parties read" on public.payments;

create policy "payments parties read"
on public.payments
for select
to authenticated
using (
  exists(
    select 1
    from public.orders o
    where o.id=payments.order_id
      and (
        o.customer_id=(select auth.uid())
        or o.assigned_agent_id=(select auth.uid())
      )
  )
  or private.is_admin()
);
