create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;

create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active=true)
$$;
create or replace function private.can_access_order(p_order_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=p_order_id and (o.customer_id=auth.uid() or o.assigned_agent_id=auth.uid() or private.is_admin()))
$$;
revoke all on function private.is_admin() from public,anon;
revoke all on function private.can_access_order(uuid) from public,anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_access_order(uuid) to authenticated;

create or replace function public.order_status_label_ar(p_status public.order_status) returns text language sql immutable set search_path='' as $$
 select case p_status when 'submitted' then 'تم استلام الطلب' when 'accepted' then 'تم قبول الطلب' when 'in_progress' then 'قيد التجهيز'
 when 'submitted_to_authority' then 'تم تقديم المعاملة' when 'processing' then 'قيد المعالجة لدى الجهة المختصة'
 when 'ready_for_collection' then 'جاهز للاستلام' when 'collected' then 'تم استلام المستند'
 when 'completed' then 'تم التسليم' when 'cancelled' then 'تم إلغاء الطلب' end
$$;

revoke all on function public.is_admin() from public,anon,authenticated;
revoke all on function public.can_access_order(uuid) from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;

drop policy if exists "profiles own read" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own read" on public.profiles for select to authenticated using(id=(select auth.uid()) or private.is_admin());

drop policy if exists "agent profile own read" on public.agent_profiles;
drop policy if exists "agent profile own insert" on public.agent_profiles;
drop policy if exists "agent profile own update pending" on public.agent_profiles;
create policy "agent profile own read" on public.agent_profiles for select to authenticated using(user_id=(select auth.uid()) or private.is_admin());

drop policy if exists "coverage own read" on public.agent_coverage;
drop policy if exists "coverage own write" on public.agent_coverage;
create policy "coverage own read" on public.agent_coverage for select to authenticated using(agent_id=(select auth.uid()) or private.is_admin());

drop policy if exists "services public read" on public.services;
create policy "services public read" on public.services for select to anon,authenticated using(active=true or private.is_admin());

drop policy if exists "orders parties read" on public.orders;
create policy "orders parties read" on public.orders for select to authenticated using(customer_id=(select auth.uid()) or assigned_agent_id=(select auth.uid()) or private.is_admin());

drop policy if exists "order items parties read" on public.order_items;
create policy "order items parties read" on public.order_items for select to authenticated using(private.can_access_order(order_id));

drop policy if exists "events parties read" on public.order_events;
create policy "events parties read" on public.order_events for select to authenticated
using(private.can_access_order(order_id) and (visible_to_customer or exists(select 1 from public.orders o where o.id=order_id and o.assigned_agent_id=(select auth.uid())) or private.is_admin()));

drop policy if exists "documents parties read" on public.documents;
drop policy if exists "documents parties insert" on public.documents;
create policy "documents parties read" on public.documents for select to authenticated
using(private.can_access_order(order_id) and (visible_to_customer or exists(select 1 from public.orders o where o.id=order_id and o.assigned_agent_id=(select auth.uid())) or private.is_admin()));
create policy "documents parties insert" on public.documents for insert to authenticated with check(private.can_access_order(order_id));

drop policy if exists "expenses agent own read" on public.order_expenses;
drop policy if exists "expenses agent own insert" on public.order_expenses;
create policy "expenses agent own read" on public.order_expenses for select to authenticated using(agent_id=(select auth.uid()) or private.is_admin());
create policy "expenses agent own insert" on public.order_expenses for insert to authenticated with check(agent_id=(select auth.uid()) and private.can_access_order(order_id));

drop policy if exists "payments customer read" on public.payments;
create policy "payments customer read" on public.payments for select to authenticated
using(exists(select 1 from public.orders o where o.id=order_id and o.customer_id=(select auth.uid())) or private.is_admin());

drop policy if exists "ledger own read" on public.agent_ledger;
create policy "ledger own read" on public.agent_ledger for select to authenticated using(agent_id=(select auth.uid()) or private.is_admin());
drop policy if exists "payout own read" on public.payouts;
create policy "payout own read" on public.payouts for select to authenticated using(agent_id=(select auth.uid()) or private.is_admin());

drop policy if exists "ratings customer read" on public.ratings;
create policy "ratings customer read" on public.ratings for select to authenticated using(customer_id=(select auth.uid()) or agent_id=(select auth.uid()) or private.is_admin());

drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using(user_id=(select auth.uid()) or private.is_admin());

drop policy if exists "audit admin read" on public.audit_log;
create policy "audit admin read" on public.audit_log for select to authenticated using(private.is_admin());

create policy "dispatch offer own read" on public.dispatch_offers for select to authenticated using(agent_id=(select auth.uid()) or private.is_admin());

drop policy if exists "order files read" on storage.objects;
drop policy if exists "order files insert" on storage.objects;
create policy "order files read" on storage.objects for select to authenticated using(
 bucket_id='order-files' and exists(select 1 from public.orders o where o.id::text=(storage.foldername(name))[1] and (o.customer_id=(select auth.uid()) or o.assigned_agent_id=(select auth.uid()) or private.is_admin()))
);
create policy "order files insert" on storage.objects for insert to authenticated with check(
 bucket_id='order-files' and exists(select 1 from public.orders o where o.id::text=(storage.foldername(name))[1] and (o.customer_id=(select auth.uid()) or o.assigned_agent_id=(select auth.uid()) or private.is_admin()))
);

create or replace function public.update_my_profile(p_full_name text,p_phone text,p_locale text default 'ar')
returns public.profiles language plpgsql security definer set search_path='' as $$
declare v public.profiles;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 update public.profiles set full_name=nullif(trim(p_full_name),''),phone=nullif(trim(p_phone),''),locale=case when p_locale in ('ar','en','fr') then p_locale else 'ar' end where id=auth.uid() returning * into v;
 return v;
end $$;

create or replace function public.apply_as_agent() returns public.agent_profiles language plpgsql security definer set search_path='' as $$
declare v public.agent_profiles;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 update public.profiles set role='agent' where id=auth.uid() and role='customer';
 insert into public.agent_profiles(user_id,verification_status,available) values(auth.uid(),'pending',false)
 on conflict(user_id) do update set updated_at=now() returning * into v;
 return v;
end $$;

create or replace function public.set_agent_availability(p_available boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.agent_profiles set available=p_available where user_id=auth.uid() and verification_status='approved';
 if not found then raise exception 'agent_not_approved'; end if;
end $$;

create or replace function public.replace_agent_coverage(p_governorate text,p_district text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.agent_profiles where user_id=auth.uid()) then raise exception 'agent_profile_required'; end if;
 insert into public.agent_coverage(agent_id,governorate,district,active) values(auth.uid(),trim(p_governorate),nullif(trim(p_district),''),true)
 on conflict(agent_id,governorate,district) do update set active=true;
end $$;

create or replace function public.admin_set_agent_status(p_agent_id uuid,p_status public.agent_verification_status) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'admin_required'; end if;
 update public.agent_profiles set verification_status=p_status,approved_at=case when p_status='approved' then now() else approved_at end,available=case when p_status='approved' then available else false end where user_id=p_agent_id;
 if not found then raise exception 'agent_not_found'; end if;
 insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'agent_status_changed','agent',p_agent_id::text,jsonb_build_object('status',p_status));
end $$;

create or replace function public.admin_update_service(p_service_id uuid,p_customer_price numeric,p_agent_payout numeric,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'admin_required'; end if;
 update public.services set customer_price=p_customer_price,agent_payout=p_agent_payout,active=p_active where id=p_service_id;
 if not found then raise exception 'service_not_found'; end if;
 insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'service_updated','service',p_service_id::text,jsonb_build_object('customer_price',p_customer_price,'agent_payout',p_agent_payout,'active',p_active));
end $$;

revoke execute on function public.create_order(text,text,text,text,text,text,text,text,text,text[]) from public,anon;
revoke execute on function public.list_available_orders() from public,anon;
revoke execute on function public.accept_order(uuid) from public,anon;
revoke execute on function public.update_order_status(uuid,public.order_status,text) from public,anon;
revoke execute on function public.cancel_own_order(uuid) from public,anon;
revoke execute on function public.update_my_profile(text,text,text) from public,anon;
revoke execute on function public.apply_as_agent() from public,anon;
revoke execute on function public.set_agent_availability(boolean) from public,anon;
revoke execute on function public.replace_agent_coverage(text,text) from public,anon;
revoke execute on function public.admin_set_agent_status(uuid,public.agent_verification_status) from public,anon;
revoke execute on function public.admin_update_service(uuid,numeric,numeric,boolean) from public,anon;

grant execute on function public.update_my_profile(text,text,text) to authenticated;
grant execute on function public.apply_as_agent() to authenticated;
grant execute on function public.set_agent_availability(boolean) to authenticated;
grant execute on function public.replace_agent_coverage(text,text) to authenticated;
grant execute on function public.admin_set_agent_status(uuid,public.agent_verification_status) to authenticated;
grant execute on function public.admin_update_service(uuid,numeric,numeric,boolean) to authenticated;

create index if not exists idx_order_items_service on public.order_items(service_id);
create index if not exists idx_dispatch_agent on public.dispatch_offers(agent_id,status);
create index if not exists idx_expenses_order on public.order_expenses(order_id);
create index if not exists idx_expenses_agent on public.order_expenses(agent_id);
create index if not exists idx_payments_order on public.payments(order_id);
create index if not exists idx_payouts_agent on public.payouts(agent_id);
create index if not exists idx_ratings_agent on public.ratings(agent_id);
create index if not exists idx_ratings_customer on public.ratings(customer_id);
create index if not exists idx_disputes_order on public.disputes(order_id);
create index if not exists idx_notifications_order on public.notifications(order_id);
create index if not exists idx_agent_ledger_order on public.agent_ledger(order_id);
