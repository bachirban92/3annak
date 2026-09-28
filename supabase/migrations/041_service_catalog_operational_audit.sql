update public.services
set description_ar=case code
  when 'property_certificate' then 'إفادة من السجل العقاري عن العقار وقيوده'
  when 'cadastral_map' then 'خريطة مساحة للعقار من دوائر المساحة بحسب السجلات المتاحة'
  when 'planning_easement' then 'إفادة رسمية تبيّن التخطيطات التي تصيب العقار ونظام البناء المطبق عليه'
  when 'area_statement' then 'إفادة كيل أو بيان مساحة من دائرة المساحة بحسب وضع العقار'
  when 'ownership_statement' then 'إفادة عن الملكية بحسب قيود الدوائر العقارية'
  when 'full_file' then 'ملف واحد يجمع المستندات العقارية الخمسة المتاحة للعقار'
  else description_ar
end
where code in ('property_certificate','cadastral_map','planning_easement','area_statement','ownership_statement','full_file');

insert into public.service_requirements(service_id,code,label_ar,requirement_type,required,active,sort_order)
select id,'planning_purpose','الغاية من إفادة التخطيط','text',true,true,40
from public.services
where code='planning_easement'
and not exists(
  select 1 from public.service_requirements r
  where r.service_id=public.services.id and r.code='planning_purpose'
);

insert into public.service_requirements(service_id,code,label_ar,requirement_type,required,active,sort_order)
select id,'applicant_address','العنوان الكامل لصاحب الطلب','text',true,true,50
from public.services
where code='planning_easement'
and not exists(
  select 1 from public.service_requirements r
  where r.service_id=public.services.id and r.code='applicant_address'
);
