create extension if not exists "pgcrypto";

do $$ begin create type public.user_role as enum ('customer','agent','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.agent_verification_status as enum ('pending','approved','rejected','suspended'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('submitted','accepted','in_progress','submitted_to_authority','processing','ready_for_collection','collected','completed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_status as enum ('pending','paid','failed','refunded','partially_refunded'); exception when duplicate_object then null; end $$;
do $$ begin create type public.offer_status as enum ('available','accepted','declined','expired','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.document_kind as enum ('customer_attachment','authorization','government_receipt','final_document','agent_proof','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.expense_status as enum ('submitted','approved','rejected','reimbursed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ledger_entry_type as enum ('job_earning','expense_reimbursement','adjustment','payout'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ledger_status as enum ('pending','available','paid','void'); exception when duplicate_object then null; end $$;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 role public.user_role not null default 'customer', full_name text, phone text, email text,
 locale text not null default 'ar', is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.agent_profiles (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 verification_status public.agent_verification_status not null default 'pending',
 government_id_last4 text, notes text, completed_orders integer not null default 0 check(completed_orders>=0),
 rating numeric(2,1) check(rating is null or rating between 0 and 5),
 available boolean not null default false, created_at timestamptz not null default now(),
 approved_at timestamptz, updated_at timestamptz not null default now()
);
create table public.agent_coverage (
 id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agent_profiles(user_id) on delete cascade,
 governorate text not null, district text, active boolean not null default true, created_at timestamptz not null default now(),
 unique(agent_id,governorate,district)
);
create table public.services (
 id uuid primary key default gen_random_uuid(), code text unique not null, name_ar text not null, description_ar text,
 customer_price numeric(10,2) not null default 0 check(customer_price>=0),
 agent_payout numeric(10,2) not null default 0 check(agent_payout>=0),
 expected_days_min integer check(expected_days_min is null or expected_days_min>=0),
 expected_days_max integer check(expected_days_max is null or expected_days_max>=0),
 requires_authorization boolean not null default false, active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create sequence public.order_number_seq start with 1000;
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 public_code text unique not null default ('ANK-'||lpad(nextval('public.order_number_seq')::text,6,'0')),
 customer_id uuid not null references public.profiles(id) on delete restrict,
 assigned_agent_id uuid references public.agent_profiles(user_id) on delete set null,
 customer_name text, customer_phone text not null, customer_email text,
 governorate text not null, district text, cadastral_area text not null, property_number text not null, property_section text, notes text,
 status public.order_status not null default 'submitted', currency text not null default 'USD' check(currency~'^[A-Z]{3}$'),
 services_total numeric(10,2) not null default 0 check(services_total>=0),
 official_fees numeric(10,2) not null default 0 check(official_fees>=0),
 total_amount numeric(10,2) not null default 0 check(total_amount>=0),
 payment_status public.payment_status not null default 'pending',
 submitted_at timestamptz not null default now(), accepted_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 service_id uuid not null references public.services(id), service_name_ar text not null,
 customer_price numeric(10,2) not null check(customer_price>=0), agent_payout numeric(10,2) not null check(agent_payout>=0),
 created_at timestamptz not null default now(), unique(order_id,service_id)
);
create table public.dispatch_offers (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 agent_id uuid not null references public.agent_profiles(user_id) on delete cascade,
 status public.offer_status not null default 'available', offered_at timestamptz not null default now(), responded_at timestamptz,
 unique(order_id,agent_id)
);
create table public.order_events (
 id bigint generated always as identity primary key, order_id uuid not null references public.orders(id) on delete cascade,
 status public.order_status not null, label_ar text not null, note text, visible_to_customer boolean not null default true,
 created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table public.documents (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 kind public.document_kind not null default 'other', storage_path text not null, original_name text, mime_type text,
 file_size bigint check(file_size is null or file_size>=0), visible_to_customer boolean not null default false,
 uploaded_by uuid references public.profiles(id) on delete set null, verified_by uuid references public.profiles(id) on delete set null,
 verified_at timestamptz, created_at timestamptz not null default now()
);
create table public.order_expenses (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 agent_id uuid not null references public.agent_profiles(user_id) on delete restrict, category text not null,
 amount numeric(10,2) not null check(amount>=0), currency text not null default 'USD' check(currency~'^[A-Z]{3}$'),
 receipt_document_id uuid references public.documents(id) on delete set null, status public.expense_status not null default 'submitted',
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references public.profiles(id) on delete set null
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 provider text, provider_reference text, amount numeric(10,2) not null check(amount>=0),
 currency text not null default 'USD' check(currency~'^[A-Z]{3}$'), status public.payment_status not null default 'pending',
 paid_at timestamptz, refunded_at timestamptz, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.agent_ledger (
 id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agent_profiles(user_id) on delete restrict,
 order_id uuid references public.orders(id) on delete set null, entry_type public.ledger_entry_type not null,
 amount numeric(10,2) not null, currency text not null default 'USD' check(currency~'^[A-Z]{3}$'),
 status public.ledger_status not null default 'pending', description text,
 created_at timestamptz not null default now(), available_at timestamptz, paid_at timestamptz
);
create table public.payouts (
 id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agent_profiles(user_id) on delete restrict,
 amount numeric(10,2) not null check(amount>=0), currency text not null default 'USD' check(currency~'^[A-Z]{3}$'),
 status public.ledger_status not null default 'pending', period_start date, period_end date, provider text, provider_reference text,
 created_at timestamptz not null default now(), paid_at timestamptz
);
create table public.ratings (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id) on delete cascade,
 customer_id uuid not null references public.profiles(id) on delete cascade, agent_id uuid not null references public.agent_profiles(user_id) on delete cascade,
 rating integer not null check(rating between 1 and 5), comment text, created_at timestamptz not null default now()
);
create table public.disputes (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 opened_by uuid not null references public.profiles(id) on delete restrict, reason text not null,
 status text not null default 'open' check(status in ('open','reviewing','resolved','closed')), resolution text,
 created_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references public.profiles(id) on delete set null
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 order_id uuid references public.orders(id) on delete cascade, channel text not null check(channel in ('in_app','email','sms','whatsapp','push')),
 title text not null, body text not null, read_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now()
);
create table public.audit_log (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null,
 action text not null, entity_type text not null, entity_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.app_settings (
 key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger agent_profiles_set_updated_at before update on public.agent_profiles for each row execute function public.set_updated_at();
create trigger services_set_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name,phone,email)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.phone,new.email) on conflict(id) do nothing;
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active=true)
$$;
create or replace function public.can_access_order(p_order_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=p_order_id and (o.customer_id=auth.uid() or o.assigned_agent_id=auth.uid() or public.is_admin()))
$$;
create or replace function public.order_status_label_ar(p_status public.order_status) returns text language sql immutable as $$
 select case p_status when 'submitted' then 'تم استلام الطلب' when 'accepted' then 'تم قبول الطلب' when 'in_progress' then 'قيد التجهيز'
 when 'submitted_to_authority' then 'تم تقديم المعاملة' when 'processing' then 'قيد المعالجة لدى الجهة المختصة'
 when 'ready_for_collection' then 'جاهز للاستلام' when 'collected' then 'تم استلام المستند'
 when 'completed' then 'تم التسليم' when 'cancelled' then 'تم إلغاء الطلب' end
$$;

create or replace function public.create_order(p_customer_name text,p_customer_phone text,p_customer_email text,p_governorate text,p_district text,p_cadastral_area text,p_property_number text,p_property_section text,p_notes text,p_service_codes text[])
returns table(order_id uuid,public_code text,total_amount numeric) language plpgsql security definer set search_path='' as $$
declare v_order_id uuid; v_total numeric(10,2);
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if coalesce(array_length(p_service_codes,1),0)=0 then raise exception 'service_required'; end if;
 if exists(select 1 from unnest(p_service_codes)c where not exists(select 1 from public.services s where s.code=c and s.active=true)) then raise exception 'invalid_service'; end if;
 select coalesce(sum(customer_price),0) into v_total from public.services where code=any(p_service_codes) and active=true;
 insert into public.orders(customer_id,customer_name,customer_phone,customer_email,governorate,district,cadastral_area,property_number,property_section,notes,services_total,total_amount)
 values(auth.uid(),nullif(trim(p_customer_name),''),trim(p_customer_phone),nullif(trim(p_customer_email),''),trim(p_governorate),nullif(trim(p_district),''),trim(p_cadastral_area),trim(p_property_number),nullif(trim(p_property_section),''),nullif(trim(p_notes),''),v_total,v_total)
 returning id into v_order_id;
 insert into public.order_items(order_id,service_id,service_name_ar,customer_price,agent_payout)
 select v_order_id,id,name_ar,customer_price,agent_payout from public.services where code=any(p_service_codes) and active=true;
 insert into public.order_events(order_id,status,label_ar,created_by) values(v_order_id,'submitted',public.order_status_label_ar('submitted'),auth.uid());
 return query select o.id,o.public_code,o.total_amount from public.orders o where o.id=v_order_id;
end $$;

create or replace function public.list_available_orders()
returns table(id uuid,public_code text,governorate text,district text,cadastral_area text,service_names text,agent_payout numeric,submitted_at timestamptz)
language sql stable security definer set search_path='' as $$
 select o.id,o.public_code,o.governorate,o.district,o.cadastral_area,string_agg(oi.service_name_ar,'، ' order by oi.created_at),sum(oi.agent_payout),o.submitted_at
 from public.orders o join public.order_items oi on oi.order_id=o.id join public.agent_profiles ap on ap.user_id=auth.uid()
 where o.status='submitted' and o.assigned_agent_id is null and ap.verification_status='approved' and ap.available=true
 and exists(select 1 from public.agent_coverage ac where ac.agent_id=auth.uid() and ac.active=true and lower(ac.governorate)=lower(o.governorate) and (ac.district is null or lower(ac.district)=lower(coalesce(o.district,''))))
 group by o.id,o.public_code,o.governorate,o.district,o.cadastral_area,o.submitted_at order by o.submitted_at
$$;

create or replace function public.accept_order(p_order_id uuid) returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders; v_payout numeric(10,2);
begin
 if not exists(select 1 from public.agent_profiles where user_id=auth.uid() and verification_status='approved' and available=true) then raise exception 'agent_not_eligible'; end if;
 update public.orders o set assigned_agent_id=auth.uid(),status='accepted',accepted_at=now()
 where o.id=p_order_id and o.status='submitted' and o.assigned_agent_id is null
 and exists(select 1 from public.agent_coverage ac where ac.agent_id=auth.uid() and ac.active=true and lower(ac.governorate)=lower(o.governorate) and (ac.district is null or lower(ac.district)=lower(coalesce(o.district,''))))
 returning o.* into v_order;
 if v_order.id is null then raise exception 'order_unavailable'; end if;
 insert into public.order_events(order_id,status,label_ar,created_by) values(p_order_id,'accepted',public.order_status_label_ar('accepted'),auth.uid());
 select coalesce(sum(agent_payout),0) into v_payout from public.order_items where order_id=p_order_id;
 insert into public.agent_ledger(agent_id,order_id,entry_type,amount,status,description) values(auth.uid(),p_order_id,'job_earning',v_payout,'pending','بدل تنفيذ الطلب');
 return v_order;
end $$;

create or replace function public.update_order_status(p_order_id uuid,p_status public.order_status,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_current public.order_status; v_agent uuid;
begin
 select status,assigned_agent_id into v_current,v_agent from public.orders where id=p_order_id for update;
 if v_current is null then raise exception 'order_not_found'; end if;
 if not public.is_admin() and v_agent<>auth.uid() then raise exception 'not_authorized'; end if;
 update public.orders set status=p_status,completed_at=case when p_status='completed' then now() else completed_at end,cancelled_at=case when p_status='cancelled' then now() else cancelled_at end where id=p_order_id;
 insert into public.order_events(order_id,status,label_ar,note,created_by) values(p_order_id,p_status,public.order_status_label_ar(p_status),nullif(trim(p_note),''),auth.uid());
 if p_status='completed' and v_agent is not null then
  update public.agent_ledger set status='available',available_at=now() where order_id=p_order_id and agent_id=v_agent and entry_type='job_earning' and status='pending';
  update public.agent_profiles set completed_orders=completed_orders+1 where user_id=v_agent;
 end if;
end $$;

create or replace function public.cancel_own_order(p_order_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.orders set status='cancelled',cancelled_at=now() where id=p_order_id and customer_id=auth.uid() and status='submitted';
 if not found then raise exception 'order_cannot_be_cancelled'; end if;
 insert into public.order_events(order_id,status,label_ar,created_by) values(p_order_id,'cancelled',public.order_status_label_ar('cancelled'),auth.uid());
end $$;

insert into public.services(code,name_ar,description_ar,customer_price,agent_payout,sort_order) values
('property_certificate','إفادة عقارية','طلب ومتابعة إفادة عقارية',35,18,10),
('cadastral_map','خريطة مساحة','طلب خريطة المساحة المتاحة للعقار',35,18,20),
('planning_easement','إفادة ارتفاق وتخطيط','متابعة إفادة الارتفاق والتخطيط',49,24,30),
('area_statement','بيان كيل مساحة','متابعة بيان كيل المساحة',39,20,40),
('ownership_statement','بيان ملكية','متابعة بيان الملكية',35,18,50),
('full_file','ملف عقار كامل','مجموعة المستندات المتاحة للعقار ضمن طلب واحد',119,55,5);

insert into public.app_settings(key,value) values('platform','{"name_ar":"عنّك","currency":"USD","support_whatsapp":null}'::jsonb);
insert into storage.buckets(id,name,public) values('order-files','order-files',false);

create index idx_orders_customer on public.orders(customer_id,created_at desc);
create index idx_orders_agent on public.orders(assigned_agent_id,status);
create index idx_orders_dispatch on public.orders(status,governorate,district,submitted_at);
create index idx_order_items_order on public.order_items(order_id);
create index idx_events_order on public.order_events(order_id,created_at);
create index idx_documents_order on public.documents(order_id,created_at);
create index idx_coverage_agent on public.agent_coverage(agent_id,active);
create index idx_notifications_user on public.notifications(user_id,created_at desc);
create index idx_ledger_agent on public.agent_ledger(agent_id,status,created_at desc);

alter table public.profiles enable row level security; alter table public.agent_profiles enable row level security;
alter table public.agent_coverage enable row level security; alter table public.services enable row level security;
alter table public.orders enable row level security; alter table public.order_items enable row level security;
alter table public.dispatch_offers enable row level security; alter table public.order_events enable row level security;
alter table public.documents enable row level security; alter table public.order_expenses enable row level security;
alter table public.payments enable row level security; alter table public.agent_ledger enable row level security;
alter table public.payouts enable row level security; alter table public.ratings enable row level security;
alter table public.disputes enable row level security; alter table public.notifications enable row level security;
alter table public.audit_log enable row level security; alter table public.app_settings enable row level security;

create policy "profiles own read" on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy "profiles own update" on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
create policy "agent profile own read" on public.agent_profiles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy "agent profile own insert" on public.agent_profiles for insert to authenticated with check(user_id=auth.uid());
create policy "agent profile own update pending" on public.agent_profiles for update to authenticated using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
create policy "coverage own read" on public.agent_coverage for select to authenticated using(agent_id=auth.uid() or public.is_admin());
create policy "coverage own write" on public.agent_coverage for all to authenticated using(agent_id=auth.uid() or public.is_admin()) with check(agent_id=auth.uid() or public.is_admin());
create policy "services public read" on public.services for select to anon,authenticated using(active=true or public.is_admin());
create policy "orders parties read" on public.orders for select to authenticated using(customer_id=auth.uid() or assigned_agent_id=auth.uid() or public.is_admin());
create policy "order items parties read" on public.order_items for select to authenticated using(public.can_access_order(order_id));
create policy "events parties read" on public.order_events for select to authenticated using(public.can_access_order(order_id));
create policy "documents parties read" on public.documents for select to authenticated using(public.can_access_order(order_id));
create policy "documents parties insert" on public.documents for insert to authenticated with check(public.can_access_order(order_id));
create policy "expenses agent own read" on public.order_expenses for select to authenticated using(agent_id=auth.uid() or public.is_admin());
create policy "expenses agent own insert" on public.order_expenses for insert to authenticated with check(agent_id=auth.uid() and public.can_access_order(order_id));
create policy "payments customer read" on public.payments for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()) or public.is_admin());
create policy "ledger own read" on public.agent_ledger for select to authenticated using(agent_id=auth.uid() or public.is_admin());
create policy "payout own read" on public.payouts for select to authenticated using(agent_id=auth.uid() or public.is_admin());
create policy "ratings customer read" on public.ratings for select to authenticated using(customer_id=auth.uid() or agent_id=auth.uid() or public.is_admin());
create policy "notifications own read" on public.notifications for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy "audit admin read" on public.audit_log for select to authenticated using(public.is_admin());
create policy "settings public read" on public.app_settings for select to anon,authenticated using(true);

create policy "order files read" on storage.objects for select to authenticated using(bucket_id='order-files' and exists(select 1 from public.orders o where o.id::text=(storage.foldername(name))[1] and (o.customer_id=auth.uid() or o.assigned_agent_id=auth.uid() or public.is_admin())));
create policy "order files insert" on storage.objects for insert to authenticated with check(bucket_id='order-files' and exists(select 1 from public.orders o where o.id::text=(storage.foldername(name))[1] and (o.customer_id=auth.uid() or o.assigned_agent_id=auth.uid() or public.is_admin())));

grant execute on function public.create_order(text,text,text,text,text,text,text,text,text,text[]) to authenticated;
grant execute on function public.list_available_orders() to authenticated;
grant execute on function public.accept_order(uuid) to authenticated;
grant execute on function public.update_order_status(uuid,public.order_status,text) to authenticated;
grant execute on function public.cancel_own_order(uuid) to authenticated;
grant select on public.services to anon,authenticated;
grant select on public.app_settings to anon,authenticated;
