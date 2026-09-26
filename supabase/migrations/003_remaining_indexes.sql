create index if not exists idx_audit_actor on public.audit_log(actor_id);
create index if not exists idx_disputes_opened_by on public.disputes(opened_by);
create index if not exists idx_disputes_resolved_by on public.disputes(resolved_by);
create index if not exists idx_documents_uploaded_by on public.documents(uploaded_by);
create index if not exists idx_documents_verified_by on public.documents(verified_by);
create index if not exists idx_events_created_by on public.order_events(created_by);
create index if not exists idx_expenses_receipt on public.order_expenses(receipt_document_id);
create index if not exists idx_expenses_reviewed_by on public.order_expenses(reviewed_by);
