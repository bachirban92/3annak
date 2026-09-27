create or replace function public.get_order_feedback(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if not exists(
    select 1 from public.orders
    where id=p_order_id and (customer_id=auth.uid() or assigned_agent_id=auth.uid() or private.is_admin())
  ) then raise exception 'not_authorized'; end if;

  select jsonb_build_object(
    'rating',(select to_jsonb(r) from public.ratings r where r.order_id=p_order_id limit 1),
    'dispute',(select to_jsonb(d) from public.disputes d where d.order_id=p_order_id order by d.created_at desc limit 1)
  ) into v;

  return v;
end;
$$;

create or replace function public.open_dispute(p_order_id uuid,p_reason text)
returns public.disputes language plpgsql security definer set search_path='' as $$
declare v_dispute public.disputes;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;

  if not exists(
    select 1 from public.orders
    where id=p_order_id and (customer_id=auth.uid() or assigned_agent_id=auth.uid())
  ) then raise exception 'not_authorized'; end if;

  if exists(
    select 1 from public.disputes
    where order_id=p_order_id and opened_by=auth.uid() and status in ('open','reviewing')
  ) then raise exception 'dispute_already_open'; end if;

  insert into public.disputes(order_id,opened_by,reason)
  values(p_order_id,auth.uid(),trim(p_reason))
  returning * into v_dispute;

  insert into public.notifications(user_id,order_id,channel,title,body,sent_at)
  select p.id,p_order_id,'in_app','طلب دعم جديد','تم فتح طلب دعم على '||o.public_code,now()
  from public.profiles p
  join public.orders o on o.id=p_order_id
  where p.role='admin' and p.is_active=true;

  return v_dispute;
end;
$$;

revoke execute on function public.get_order_feedback(uuid) from public,anon;
revoke execute on function public.open_dispute(uuid,text) from public,anon;
grant execute on function public.get_order_feedback(uuid) to authenticated;
grant execute on function public.open_dispute(uuid,text) to authenticated;
