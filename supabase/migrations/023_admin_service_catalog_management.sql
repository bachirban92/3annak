alter table public.services
  add column if not exists service_type text not null default 'document';

alter table public.services
  drop constraint if exists services_service_type_check;

alter table public.services
  add constraint services_service_type_check
  check(service_type in ('document','bundle'));

update public.services set service_type='bundle' where code='full_file';

create or replace function public.admin_create_service(
  p_name_ar text,p_description_ar text default null,p_customer_price numeric default 0,
  p_official_fee numeric default 0,p_agent_payout numeric default 0,
  p_expected_days_min integer default null,p_expected_days_max integer default null,p_active boolean default true
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text := 'doc_'||replace(v_id::text,'-','');
  v_sort integer;
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if length(trim(coalesce(p_name_ar,'')))<2 then raise exception 'service_name_required'; end if;
  if coalesce(p_customer_price,0)<0 or coalesce(p_official_fee,0)<0 or coalesce(p_agent_payout,0)<0
    then raise exception 'invalid_amount'; end if;
  if p_expected_days_min is not null and p_expected_days_min<0 then raise exception 'invalid_eta'; end if;
  if p_expected_days_max is not null and p_expected_days_max<0 then raise exception 'invalid_eta'; end if;
  if p_expected_days_min is not null and p_expected_days_max is not null and p_expected_days_max<p_expected_days_min
    then raise exception 'invalid_eta'; end if;

  select coalesce(max(sort_order),0)+10 into v_sort from public.services;

  insert into public.services(
    id,code,name_ar,description_ar,customer_price,official_fee,agent_payout,
    expected_days_min,expected_days_max,active,sort_order,service_type
  )
  values(
    v_id,v_code,trim(p_name_ar),nullif(trim(p_description_ar),''),
    coalesce(p_customer_price,0),coalesce(p_official_fee,0),coalesce(p_agent_payout,0),
    p_expected_days_min,p_expected_days_max,coalesce(p_active,true),v_sort,'document'
  );

  insert into public.service_workflow_steps(service_id,status,label_ar,sort_order,active)
  values
    (v_id,'in_progress','بدء العمل',10,true),
    (v_id,'submitted_to_authority','تم تقديم المعاملة',20,true),
    (v_id,'processing','قيد المعالجة',30,true),
    (v_id,'ready_for_collection','جاهز للاستلام',40,true),
    (v_id,'collected','تم استلام المستند',50,true)
  on conflict(service_id,status) do nothing;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'service_created','service',v_id::text,jsonb_build_object('name_ar',trim(p_name_ar)));

  return v_id;
end;
$$;

create or replace function public.admin_update_service_catalog(
  p_service_id uuid,p_name_ar text,p_description_ar text,p_customer_price numeric,p_official_fee numeric,
  p_agent_payout numeric,p_expected_days_min integer,p_expected_days_max integer,p_active boolean
)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if length(trim(coalesce(p_name_ar,'')))<2 then raise exception 'service_name_required'; end if;
  if coalesce(p_customer_price,0)<0 or coalesce(p_official_fee,0)<0 or coalesce(p_agent_payout,0)<0
    then raise exception 'invalid_amount'; end if;
  if p_expected_days_min is not null and p_expected_days_min<0 then raise exception 'invalid_eta'; end if;
  if p_expected_days_max is not null and p_expected_days_max<0 then raise exception 'invalid_eta'; end if;
  if p_expected_days_min is not null and p_expected_days_max is not null and p_expected_days_max<p_expected_days_min
    then raise exception 'invalid_eta'; end if;

  update public.services
  set name_ar=trim(p_name_ar),
      description_ar=nullif(trim(p_description_ar),''),
      customer_price=coalesce(p_customer_price,0),
      official_fee=coalesce(p_official_fee,0),
      agent_payout=coalesce(p_agent_payout,0),
      expected_days_min=p_expected_days_min,
      expected_days_max=p_expected_days_max,
      active=coalesce(p_active,false),
      updated_at=now()
  where id=p_service_id;

  if not found then raise exception 'service_not_found'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),'service_catalog_updated','service',p_service_id::text,
    jsonb_build_object(
      'name_ar',trim(p_name_ar),'customer_price',p_customer_price,'official_fee',p_official_fee,
      'agent_payout',p_agent_payout,'expected_days_min',p_expected_days_min,
      'expected_days_max',p_expected_days_max,'active',p_active
    )
  );
end;
$$;

create or replace function public.admin_update_service_requirement(
  p_requirement_id uuid,p_label_ar text,p_requirement_type text,p_required boolean,p_active boolean default true
)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  if p_requirement_type not in ('file','text') then raise exception 'invalid_requirement_type'; end if;
  if length(trim(coalesce(p_label_ar,'')))<2 then raise exception 'requirement_label_required'; end if;

  update public.service_requirements
  set label_ar=trim(p_label_ar),requirement_type=p_requirement_type,
      required=coalesce(p_required,true),active=coalesce(p_active,true)
  where id=p_requirement_id;

  if not found then raise exception 'requirement_not_found'; end if;
end;
$$;

revoke execute on function public.admin_create_service(text,text,numeric,numeric,numeric,integer,integer,boolean) from public,anon;
revoke execute on function public.admin_update_service_catalog(uuid,text,text,numeric,numeric,numeric,integer,integer,boolean) from public,anon;
revoke execute on function public.admin_update_service_requirement(uuid,text,text,boolean,boolean) from public,anon;
grant execute on function public.admin_create_service(text,text,numeric,numeric,numeric,integer,integer,boolean) to authenticated;
grant execute on function public.admin_update_service_catalog(uuid,text,text,numeric,numeric,numeric,integer,integer,boolean) to authenticated;
grant execute on function public.admin_update_service_requirement(uuid,text,text,boolean,boolean) to authenticated;
