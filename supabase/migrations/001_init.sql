create extension if not exists "pgcrypto";

create type public.user_role as enum ('customer','agent','admin');
create type public.request_status as enum (
  'submitted',
  'accepted',
  'in_progress',
  'submitted_to_authority',
  'processing',
  'ready_for_collection',
  'collected',
  'completed',
  'cancelled'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.agent_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  approved boolean not null default false,
  active boolean not null default true,
  rating numeric(2,1),
  completed_requests integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_ar text not null,
  customer_price numeric(10,2),
  agent_payout numeric(10,2),
  active boolean not null default true
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null default ('LB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_id uuid references public.profiles(id) on delete set null,
  agent_id uuid references public.profiles(id) on delete set null,
  service_id uuid not null references public.services(id),
  cadastral_area text not null,
  property_number text not null,
  phone text,
  status public.request_status not null default 'submitted',
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  status public.request_status not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  storage_path text not null,
  label text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.services(code,name_ar) values
('property_certificate','إفادة عقارية'),
('cadastral_map','خريطة مساحة'),
('planning_easement','إفادة ارتفاق وتخطيط'),
('full_file','ملف عقار كامل');

alter table public.profiles enable row level security;
alter table public.agent_profiles enable row level security;
alter table public.services enable row level security;
alter table public.requests enable row level security;
alter table public.request_events enable row level security;
alter table public.request_files enable row level security;

create policy "services readable" on public.services for select using (active = true);

create policy "users read own profile" on public.profiles
for select using (auth.uid() = id);

create policy "users update own profile" on public.profiles
for update using (auth.uid() = id);

create policy "customers read own requests" on public.requests
for select using (auth.uid() = customer_id);

create policy "assigned agents read requests" on public.requests
for select using (auth.uid() = agent_id);

create policy "customers create requests" on public.requests
for insert with check (auth.uid() = customer_id);

create policy "request parties read events" on public.request_events
for select using (
  exists (
    select 1 from public.requests r
    where r.id = request_events.request_id
    and (r.customer_id = auth.uid() or r.agent_id = auth.uid())
  )
);

create policy "request parties read files" on public.request_files
for select using (
  exists (
    select 1 from public.requests r
    where r.id = request_files.request_id
    and (r.customer_id = auth.uid() or r.agent_id = auth.uid())
  )
);
