create or replace function public.notify_agent_verification_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.verification_status is distinct from old.verification_status then
    insert into public.notifications(user_id,channel,title,body,sent_at)
    values(
      new.user_id,
      'in_app',
      case
        when new.verification_status='approved' then 'تم اعتماد حساب الوكيل'
        when new.verification_status='rejected' then 'تعذر اعتماد حساب الوكيل'
        when new.verification_status='suspended' then 'تم تعليق حساب الوكيل'
        else 'تم تحديث حالة حساب الوكيل'
      end,
      case
        when new.verification_status='approved' then 'تم اعتماد حسابك ويمكنك استقبال الطلبات عند تفعيل حالة متاح.'
        when new.verification_status='rejected' then 'راجع مستندات التحقق أو تواصل مع الإدارة.'
        when new.verification_status='suspended' then 'الحساب غير متاح لاستقبال طلبات جديدة حالياً.'
        else 'حالة حسابك الآن: قيد المراجعة.'
      end,
      now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_verification_notification on public.agent_profiles;
create trigger trg_agent_verification_notification
after update of verification_status on public.agent_profiles
for each row
when (old.verification_status is distinct from new.verification_status)
execute function public.notify_agent_verification_change();

create or replace function public.notify_agent_document_review()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_label text;
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    select label_ar into v_label
    from public.agent_verification_requirements
    where id=new.requirement_id;

    insert into public.notifications(user_id,channel,title,body,sent_at)
    values(
      new.agent_id,
      'in_app',
      case when new.status='approved' then 'تم اعتماد مستند التحقق' else 'مستند التحقق يحتاج تعديل' end,
      case
        when new.status='approved'
          then coalesce(v_label,'المستند')||' — تم الاعتماد'
        else coalesce(v_label,'المستند')||coalesce(' — '||nullif(trim(new.rejection_reason),''),' — أعد رفع المستند')
      end,
      now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_document_review_notification on public.agent_documents;
create trigger trg_agent_document_review_notification
after update of status on public.agent_documents
for each row
when (old.status is distinct from new.status)
execute function public.notify_agent_document_review();
