-- Keep payment-dependent customer and agent UI in sync immediately after payment changes.
-- Required by the frontend postgres_changes subscriptions on public.payments.
alter publication supabase_realtime add table public.payments;
