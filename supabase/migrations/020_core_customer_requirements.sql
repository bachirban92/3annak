insert into public.service_requirements(service_id,code,label_ar,requirement_type,required,active,sort_order)
select s.id,'concerned_party_name','اسم صاحب العلاقة / المالك','text',true,true,10
from public.services s
where s.code in ('property_certificate','cadastral_map','planning_easement','area_statement','ownership_statement')
on conflict(service_id,code) do update
set label_ar=excluded.label_ar,requirement_type=excluded.requirement_type,required=excluded.required,active=true,sort_order=excluded.sort_order;

insert into public.service_requirements(service_id,code,label_ar,requirement_type,required,active,sort_order)
select s.id,'relationship_to_property','صفتك بالنسبة للعقار','text',true,true,20
from public.services s
where s.code in ('property_certificate','cadastral_map','planning_easement','area_statement','ownership_statement')
on conflict(service_id,code) do update
set label_ar=excluded.label_ar,requirement_type=excluded.requirement_type,required=excluded.required,active=true,sort_order=excluded.sort_order;

insert into public.service_requirements(service_id,code,label_ar,requirement_type,required,active,sort_order)
select s.id,'authorization','تفويض أو وكالة (إن وجدت)','file',false,true,30
from public.services s
where s.code in ('property_certificate','cadastral_map','planning_easement','area_statement','ownership_statement')
on conflict(service_id,code) do update
set label_ar=excluded.label_ar,requirement_type=excluded.requirement_type,required=excluded.required,active=true,sort_order=excluded.sort_order;
