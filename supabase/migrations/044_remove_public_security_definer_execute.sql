-- Remove accidental PUBLIC execute grants from security-definer RPCs.
revoke execute on function public.admin_set_agent_payout_account_verified(uuid,boolean) from public, anon;
revoke execute on function public.admin_update_hard_copy_delivery(boolean,numeric,numeric) from public, anon;
revoke execute on function public.admin_update_service(uuid,numeric,numeric,boolean,numeric) from public, anon;
revoke execute on function public.confirm_hard_copy_delivery(uuid,text) from public, anon;
revoke execute on function public.create_order(text,text,text,text,text,text,text,text,text,text[],text,uuid) from public, anon;
revoke execute on function public.delete_customer_address(uuid) from public, anon;
revoke execute on function public.delete_customer_property(uuid) from public, anon;
revoke execute on function public.finalize_order_submission(uuid) from public, anon;
revoke execute on function public.list_available_orders() from public, anon;
revoke execute on function public.register_customer_attachment(uuid,text,text,text,bigint) from public, anon;
revoke execute on function public.save_agent_payout_account(text,text,text) from public, anon;
revoke execute on function public.save_customer_address(uuid,text,text,text,text,text,text,text,boolean) from public, anon;
revoke execute on function public.save_customer_property(uuid,text,text,text,text,text,text,text,boolean) from public, anon;

grant execute on function public.admin_set_agent_payout_account_verified(uuid,boolean) to authenticated, service_role;
grant execute on function public.admin_update_hard_copy_delivery(boolean,numeric,numeric) to authenticated, service_role;
grant execute on function public.admin_update_service(uuid,numeric,numeric,boolean,numeric) to authenticated, service_role;
grant execute on function public.confirm_hard_copy_delivery(uuid,text) to authenticated, service_role;
grant execute on function public.create_order(text,text,text,text,text,text,text,text,text,text[],text,uuid) to authenticated, service_role;
grant execute on function public.delete_customer_address(uuid) to authenticated, service_role;
grant execute on function public.delete_customer_property(uuid) to authenticated, service_role;
grant execute on function public.finalize_order_submission(uuid) to authenticated, service_role;
grant execute on function public.list_available_orders() to authenticated, service_role;
grant execute on function public.register_customer_attachment(uuid,text,text,text,bigint) to authenticated, service_role;
grant execute on function public.save_agent_payout_account(text,text,text) to authenticated, service_role;
grant execute on function public.save_customer_address(uuid,text,text,text,text,text,text,text,boolean) to authenticated, service_role;
grant execute on function public.save_customer_property(uuid,text,text,text,text,text,text,text,boolean) to authenticated, service_role;

-- Trigger functions must never be exposed as RPCs.
revoke execute on function public.notify_agent_document_review() from public, anon, authenticated;
revoke execute on function public.notify_agent_verification_change() from public, anon, authenticated;
revoke execute on function public.notify_payment_status_change() from public, anon, authenticated;
