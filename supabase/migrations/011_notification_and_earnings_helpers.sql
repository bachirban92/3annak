create or replace function public.get_unread_notification_count()
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.notifications
  where user_id=auth.uid() and read_at is null;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.notifications set read_at=coalesce(read_at,now())
  where id=p_notification_id and user_id=auth.uid();
  if not found then raise exception 'notification_not_found'; end if;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path='' as $$
  update public.notifications set read_at=coalesce(read_at,now())
  where user_id=auth.uid() and read_at is null;
$$;

create or replace function public.get_agent_earnings_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if not exists(select 1 from public.agent_profiles where user_id=auth.uid())
    then raise exception 'agent_profile_required'; end if;

  select jsonb_build_object(
    'pending',coalesce(sum(amount) filter(where status='pending' and entry_type<>'payout'),0),
    'available',coalesce(sum(amount) filter(where status='available' and entry_type<>'payout'),0),
    'paid',coalesce(sum(amount) filter(where status='paid' and entry_type<>'payout'),0),
    'completed_jobs',(select completed_orders from public.agent_profiles where user_id=auth.uid())
  ) into v
  from public.agent_ledger where agent_id=auth.uid();
  return v;
end;
$$;

revoke execute on function public.get_unread_notification_count() from public,anon;
revoke execute on function public.mark_notification_read(uuid) from public,anon;
revoke execute on function public.mark_all_notifications_read() from public,anon;
revoke execute on function public.get_agent_earnings_summary() from public,anon;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.get_agent_earnings_summary() to authenticated;
