-- Account basics for customer and agent dashboards.
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'المنزل',
  address_line1 text not null,
  address_line2 text,
  city text not null,
  region text,
  postal_code text,
  country text not null default 'Lebanon',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'عقار',
  governorate text not null,
  district text,
  cadastral_area text not null,
  property_number text not null,
  property_section text,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_payout_accounts (
  user_id uuid primary key references public.agent_profiles(user_id) on delete cascade,
  account_holder text not null,
  bank_name text,
  iban text not null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_addresses enable row level security;
alter table public.customer_properties enable row level security;
alter table public.agent_payout_accounts enable row level security;

drop policy if exists "customer addresses own" on public.customer_addresses;
create policy "customer addresses own" on public.customer_addresses
for all to authenticated using (user_id=auth.uid() or private.is_admin())
with check (user_id=auth.uid() or private.is_admin());

drop policy if exists "customer properties own" on public.customer_properties;
create policy "customer properties own" on public.customer_properties
for all to authenticated using (user_id=auth.uid() or private.is_admin())
with check (user_id=auth.uid() or private.is_admin());

drop policy if exists "agent payout account own" on public.agent_payout_accounts;
create policy "agent payout account own" on public.agent_payout_accounts
for all to authenticated using (user_id=auth.uid() or private.is_admin())
with check (user_id=auth.uid() or private.is_admin());

create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id);
create index if not exists customer_properties_user_idx on public.customer_properties(user_id);

create or replace function public.save_customer_address(
  p_id uuid default null,p_label text default 'المنزل',p_address_line1 text default null,
  p_address_line2 text default null,p_city text default null,p_region text default null,
  p_postal_code text default null,p_country text default 'Lebanon',p_is_default boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if nullif(trim(p_address_line1),'') is null or nullif(trim(p_city),'') is null then raise exception 'address_required'; end if;
  if p_is_default then update public.customer_addresses set is_default=false,updated_at=now() where user_id=auth.uid(); end if;
  if p_id is null then
    insert into public.customer_addresses(user_id,label,address_line1,address_line2,city,region,postal_code,country,is_default)
    values(auth.uid(),coalesce(nullif(trim(p_label),''),'المنزل'),trim(p_address_line1),nullif(trim(p_address_line2),''),trim(p_city),nullif(trim(p_region),''),nullif(trim(p_postal_code),''),coalesce(nullif(trim(p_country),''),'Lebanon'),p_is_default)
    returning id into v_id;
  else
    update public.customer_addresses set label=coalesce(nullif(trim(p_label),''),label),address_line1=trim(p_address_line1),address_line2=nullif(trim(p_address_line2),''),city=trim(p_city),region=nullif(trim(p_region),''),postal_code=nullif(trim(p_postal_code),''),country=coalesce(nullif(trim(p_country),''),country),is_default=p_is_default,updated_at=now()
    where id=p_id and user_id=auth.uid() returning id into v_id;
    if v_id is null then raise exception 'address_not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_customer_address(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from public.customer_addresses where id=p_id and user_id=auth.uid();
  if not found then raise exception 'address_not_found'; end if;
end $$;

create or replace function public.save_customer_property(
  p_id uuid default null,p_label text default 'عقار',p_governorate text default null,
  p_district text default null,p_cadastral_area text default null,p_property_number text default null,
  p_property_section text default null,p_notes text default null,p_is_default boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if nullif(trim(p_governorate),'') is null or nullif(trim(p_cadastral_area),'') is null or nullif(trim(p_property_number),'') is null then raise exception 'property_required'; end if;
  if p_is_default then update public.customer_properties set is_default=false,updated_at=now() where user_id=auth.uid(); end if;
  if p_id is null then
    insert into public.customer_properties(user_id,label,governorate,district,cadastral_area,property_number,property_section,notes,is_default)
    values(auth.uid(),coalesce(nullif(trim(p_label),''),'عقار'),trim(p_governorate),nullif(trim(p_district),''),trim(p_cadastral_area),trim(p_property_number),nullif(trim(p_property_section),''),nullif(trim(p_notes),''),p_is_default)
    returning id into v_id;
  else
    update public.customer_properties set label=coalesce(nullif(trim(p_label),''),label),governorate=trim(p_governorate),district=nullif(trim(p_district),''),cadastral_area=trim(p_cadastral_area),property_number=trim(p_property_number),property_section=nullif(trim(p_property_section),''),notes=nullif(trim(p_notes),''),is_default=p_is_default,updated_at=now()
    where id=p_id and user_id=auth.uid() returning id into v_id;
    if v_id is null then raise exception 'property_not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_customer_property(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from public.customer_properties where id=p_id and user_id=auth.uid();
  if not found then raise exception 'property_not_found'; end if;
end $$;

create or replace function public.save_agent_payout_account(p_account_holder text,p_bank_name text,p_iban text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='agent') then raise exception 'agent_required'; end if;
  if nullif(trim(p_account_holder),'') is null or nullif(trim(p_iban),'') is null then raise exception 'payout_account_required'; end if;
  insert into public.agent_payout_accounts(user_id,account_holder,bank_name,iban,is_verified)
  values(auth.uid(),trim(p_account_holder),nullif(trim(p_bank_name),''),upper(replace(trim(p_iban),' ','')),false)
  on conflict(user_id) do update set account_holder=excluded.account_holder,bank_name=excluded.bank_name,iban=excluded.iban,is_verified=false,updated_at=now();
end $$;
