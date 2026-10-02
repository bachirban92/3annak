create table if not exists private.ops_health_alerts (
  alert_key text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  resolved_at timestamptz,
  details jsonb not null default '{}'::jsonb
);

create or replace function private.ops_health_snapshot()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_failed_cron int; v_overdue_ids int; v_completed_unpaid int;
  v_completed_workflow int; v_completed_missing_docs int;
  v_completed_hardcopy int; v_completed_pending_earning int;
  v_missing_storage int;
begin
  select count(*) into v_failed_cron
  from cron.job_run_details r join cron.job j on j.jobid=r.jobid
  where j.jobname='purge-customer-id-files-daily'
    and r.start_time>now()-interval '48 hours'
    and r.status not in ('succeeded','running');

  select count(*) into v_overdue_ids
  from public.customer_identity_verifications
  where storage_path is not null and purge_due_at is not null
    and purge_due_at<now()-interval '24 hours';

  select count(*) into v_completed_unpaid
  from public.orders o
  where o.status='completed' and o.total_amount>0
    and not exists(select 1 from public.payments p where p.order_id=o.id and p.status='paid');

  select count(*) into v_completed_workflow
  from public.orders o
  where o.status='completed'
    and exists(select 1 from public.order_workflow_steps w where w.order_id=o.id and w.completed_at is null);

  select count(*) into v_completed_missing_docs
  from public.orders o
  where o.status='completed'
    and exists(
      select 1 from public.order_deliverables od
      where od.order_id=o.id
        and not exists(
          select 1 from public.documents d
          where d.order_id=o.id and d.deliverable_id=od.id and d.kind='final_document'
        )
    );

  select count(*) into v_completed_hardcopy
  from public.orders o
  where o.status='completed' and o.delivery_mode='hard_copy' and o.hard_copy_delivered_at is null;

  select count(*) into v_completed_pending_earning
  from public.orders o
  join public.agent_ledger l on l.order_id=o.id
  where o.status='completed' and l.entry_type='job_earning' and l.status='pending';

  select
    (select count(*) from public.documents d
      where d.storage_path is not null
        and not exists(select 1 from storage.objects so where so.bucket_id='order-files' and so.name=d.storage_path))
    +
    (select count(*) from public.agent_documents d
      where d.storage_path is not null
        and not exists(select 1 from storage.objects so where so.bucket_id='agent-files' and so.name=d.storage_path))
    +
    (select count(*) from public.customer_identity_verifications v
      where v.storage_path is not null
        and not exists(select 1 from storage.objects so where so.bucket_id='customer-id-files' and so.name=v.storage_path))
  into v_missing_storage;

  return jsonb_build_object(
    'ok',(v_failed_cron+v_overdue_ids+v_completed_unpaid+v_completed_workflow+
          v_completed_missing_docs+v_completed_hardcopy+v_completed_pending_earning+v_missing_storage)=0,
    'failed_id_purge_cron',v_failed_cron,
    'overdue_id_files',v_overdue_ids,
    'completed_unpaid_orders',v_completed_unpaid,
    'completed_with_incomplete_workflow',v_completed_workflow,
    'completed_missing_final_documents',v_completed_missing_docs,
    'completed_hard_copy_not_delivered',v_completed_hardcopy,
    'completed_with_pending_agent_earning',v_completed_pending_earning,
    'missing_storage_objects',v_missing_storage,
    'checked_at',now()
  );
end;
$$;

revoke execute on function private.ops_health_snapshot() from public,anon,authenticated;

create or replace function public.admin_get_ops_health()
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'admin_required'; end if;
  return private.ops_health_snapshot();
end;
$$;

revoke execute on function public.admin_get_ops_health() from public,anon;
grant execute on function public.admin_get_ops_health() to authenticated;

create or replace function private.run_ops_health_check()
returns void language plpgsql security definer set search_path=''
as $$
declare
  v jsonb; k text; n int; v_should_notify boolean; v_details text;
begin
  v:=private.ops_health_snapshot();

  for k,n in
    select * from (values
      ('failed_id_purge_cron',(v->>'failed_id_purge_cron')::int),
      ('overdue_id_files',(v->>'overdue_id_files')::int),
      ('completed_unpaid_orders',(v->>'completed_unpaid_orders')::int),
      ('completed_with_incomplete_workflow',(v->>'completed_with_incomplete_workflow')::int),
      ('completed_missing_final_documents',(v->>'completed_missing_final_documents')::int),
      ('completed_hard_copy_not_delivered',(v->>'completed_hard_copy_not_delivered')::int),
      ('completed_with_pending_agent_earning',(v->>'completed_with_pending_agent_earning')::int),
      ('missing_storage_objects',(v->>'missing_storage_objects')::int)
    ) x(alert_key,issue_count)
  loop
    if n>0 then
      insert into private.ops_health_alerts(alert_key,details)
      values(k,jsonb_build_object('count',n))
      on conflict(alert_key) do update
      set last_seen_at=now(),resolved_at=null,details=excluded.details;

      select last_notified_at is null or last_notified_at<now()-interval '12 hours'
      into v_should_notify
      from private.ops_health_alerts where alert_key=k;

      if v_should_notify then
        v_details:=case k
          when 'failed_id_purge_cron' then 'فشل في مهمة حذف ملفات الهوية'
          when 'overdue_id_files' then 'ملفات هوية تجاوزت مدة الحذف'
          when 'completed_unpaid_orders' then 'طلبات مكتملة بدون دفع مؤكد'
          when 'completed_with_incomplete_workflow' then 'طلبات مكتملة ومراحل التنفيذ غير مكتملة'
          when 'completed_missing_final_documents' then 'طلبات مكتملة بدون كل المستندات النهائية'
          when 'completed_hard_copy_not_delivered' then 'طلبات ورقية مكتملة بدون تأكيد التوصيل'
          when 'completed_with_pending_agent_earning' then 'أرباح وكلاء ما زالت معلقة بعد الإكمال'
          when 'missing_storage_objects' then 'ملفات مسجلة في قاعدة البيانات لكنها مفقودة من التخزين'
          else 'مشكلة تشغيلية'
        end;

        insert into public.notifications(user_id,channel,title,body,sent_at)
        select p.id,'in_app','تنبيه تشغيلي',v_details||' • العدد: '||n,now()
        from public.profiles p
        where p.role='admin' and p.is_active=true;

        update private.ops_health_alerts set last_notified_at=now() where alert_key=k;
      end if;
    else
      update private.ops_health_alerts
      set resolved_at=coalesce(resolved_at,now())
      where alert_key=k and resolved_at is null;
    end if;
  end loop;
end;
$$;

revoke execute on function private.run_ops_health_check() from public,anon,authenticated;

select cron.schedule('3annak-ops-health-hourly','15 * * * *',$$select private.run_ops_health_check();$$);
select cron.schedule('cleanup-cron-history-weekly','45 3 * * 0',$$delete from cron.job_run_details where end_time<now()-interval '30 days';$$);
