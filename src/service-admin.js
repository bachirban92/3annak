import { supabase } from './supabase.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const workflowStages=[
  ['in_progress','بدء العمل'],
  ['submitted_to_authority','تم تقديم المعاملة'],
  ['processing','قيد المعالجة'],
  ['ready_for_collection','جاهز للاستلام'],
  ['collected','تم استلام المستند']
];

export function renderServicesAdmin(services=[],requirements=[],workflow=[],bundleItems=[]){
  const create='<form id="newServiceAdmin" class="serviceadmin newservice">'+
    '<div class="serviceadminhead"><span><b>إضافة نوع مستند</b><small>أنشئ خدمة جديدة وحدد السعر والمدة.</small></span></div>'+
    '<div class="servicefields">'+
      '<label><small>اسم المستند</small><input name="name" required placeholder="اسم المستند"></label>'+
      '<label class="widefield"><small>وصف مختصر</small><input name="description" placeholder="يظهر للعميل"></label>'+
      '<label><small>سعر الخدمة</small><input name="cp" type="number" min="0" step="0.01" value="0" required></label>'+
      '<label><small>الرسوم الرسمية</small><input name="official_fee" type="number" min="0" step="0.01" value="0"></label>'+
      '<label><small>بدل الوكيل</small><input name="ap" type="number" min="0" step="0.01" value="0" required></label>'+
      '<label><small>أقل مدة (أيام)</small><input name="eta_min" type="number" min="0" step="1"></label>'+
      '<label><small>أقصى مدة (أيام)</small><input name="eta_max" type="number" min="0" step="1"></label>'+
    '</div>'+
    '<button class="primary">إضافة المستند</button>'+
  '</form>';
  return create+services.map(s=>{
    const reqs=requirements.filter(r=>r.service_id===s.id&&r.active);
    const wf=workflow.filter(r=>r.service_id===s.id);
    const active=new Set(wf.filter(x=>x.active).map(x=>x.status));
    const included=new Set(bundleItems.filter(x=>x.bundle_service_id===s.id).map(x=>x.item_service_id));
    const bundleChoices=services.filter(x=>x.service_type==='document');
    return '<div class="serviceadmin">'+
      '<div class="serviceadminhead"><span><b>'+esc(s.name_ar)+'</b><small>'+(s.service_type==='bundle'?'حزمة مستندات':'نوع مستند')+'</small></span><i>'+(s.active?'فعّال':'متوقف')+'</i></div>'+
      '<form class="price servicecatalog" data-service-catalog="'+s.id+'">'+
        '<div class="servicefields">'+
          '<label><small>اسم المستند</small><input name="name" required value="'+esc(s.name_ar)+'"></label>'+
          '<label class="widefield"><small>الوصف</small><input name="description" value="'+esc(s.description_ar||'')+'"></label>'+
          '<label><small>سعر الخدمة</small><input name="cp" type="number" min="0" step="0.01" value="'+Number(s.customer_price||0)+'"></label>'+
          '<label><small>الرسوم الرسمية</small><input name="official_fee" type="number" min="0" step="0.01" value="'+Number(s.official_fee||0)+'"></label>'+
          '<label><small>بدل الوكيل</small><input name="ap" type="number" min="0" step="0.01" value="'+Number(s.agent_payout||0)+'"></label>'+
          '<label><small>أقل مدة (أيام)</small><input name="eta_min" type="number" min="0" step="1" value="'+(s.expected_days_min??'')+'"></label>'+
          '<label><small>أقصى مدة (أيام)</small><input name="eta_max" type="number" min="0" step="1" value="'+(s.expected_days_max??'')+'"></label>'+
          '<label class="check"><input name="active" type="checkbox" '+(s.active?'checked':'')+'> فعّال</label>'+
        '</div>'+
        '<button class="secondary">حفظ الخدمة</button>'+
      '</form>'+
      '<div class="serviceblock">'+
        '<div class="serviceblockhead"><b>متطلبات العميل</b><small>ما يجب إدخاله أو رفعه قبل إرسال الطلب للوكيل.</small></div>'+
        '<div class="requirementadminlist">'+(reqs.length?reqs.map(r=>
          '<form class="requirementadminrow" data-requirement="'+r.id+'">'+
            '<input name="label" value="'+esc(r.label_ar)+'" required>'+
            '<select name="type"><option value="text" '+(r.requirement_type==='text'?'selected':'')+'>معلومة</option><option value="file" '+(r.requirement_type==='file'?'selected':'')+'>ملف</option></select>'+
            '<label class="check compactcheck"><input name="required" type="checkbox" '+(r.required?'checked':'')+'> مطلوب</label>'+
            '<button class="secondary compact">حفظ</button>'+
            '<button type="button" class="ghost compact" data-disable-req="'+r.id+'">حذف</button>'+
          '</form>'
        ).join(''):'<div class="empty small">لا توجد متطلبات.</div>')+'</div>'+
        '<form class="reqadmin" data-req-service="'+s.id+'">'+
          '<input name="label" placeholder="متطلب جديد" required>'+
          '<select name="type"><option value="text">معلومة</option><option value="file">ملف</option></select>'+
          '<label class="check compactcheck"><input name="required" type="checkbox" checked> مطلوب</label>'+
          '<button class="secondary">إضافة متطلب</button>'+
        '</form>'+
      '</div>'+
      (s.service_type==='bundle'?'<div class="serviceblock">'+
        '<div class="serviceblockhead"><b>محتويات الحزمة</b><small>اختر المستندات التي يحصل عليها العميل ضمن هذه الحزمة.</small></div>'+
        '<form class="bundleadmin" data-bundle-service="'+s.id+'">'+
          '<div class="bundlechoices">'+bundleChoices.map(i=>'<label><input type="checkbox" name="item" value="'+i.id+'" '+(included.has(i.id)?'checked':'')+'><span>'+esc(i.name_ar)+'</span></label>').join('')+'</div>'+
          '<button class="secondary">حفظ محتويات الحزمة</button>'+
        '</form>'+
      '</div>':'')+
      '<div class="serviceblock">'+
        '<small class="servicelabel">مراحل التنفيذ</small>'+
        '<div class="workflowtoggles">'+workflowStages.map(([status,label])=>
          '<label><input type="checkbox" data-workflow-service="'+s.id+'" data-workflow-status="'+status+'" '+(active.has(status)?'checked':'')+'><span>'+esc(label)+'</span></label>'
        ).join('')+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

export function bindServicesAdmin({toast,busy,reload}){
  const create=document.querySelector('#newServiceAdmin');
  if(create)create.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(create),b=create.querySelector('button');
    const min=d.get('eta_min')===''?null:+d.get('eta_min');
    const max=d.get('eta_max')===''?null:+d.get('eta_max');
    if(min!==null&&max!==null&&max<min)return toast('المدة القصوى يجب أن تكون أكبر أو مساوية للمدة الدنيا',true);
    busy(b,true);
    const {error}=await supabase.rpc('admin_create_service',{
      p_name_ar:String(d.get('name')||'').trim(),
      p_description_ar:String(d.get('description')||'').trim(),
      p_customer_price:+d.get('cp')||0,
      p_official_fee:+d.get('official_fee')||0,
      p_agent_payout:+d.get('ap')||0,
      p_expected_days_min:min,
      p_expected_days_max:max,
      p_active:true
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تمت إضافة نوع المستند'),reload());
  };

  document.querySelectorAll('[data-service-catalog]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(f),b=f.querySelector('button');
    const min=d.get('eta_min')===''?null:+d.get('eta_min');
    const max=d.get('eta_max')===''?null:+d.get('eta_max');
    if(min!==null&&max!==null&&max<min)return toast('المدة القصوى يجب أن تكون أكبر أو مساوية للمدة الدنيا',true);
    busy(b,true);
    const {error}=await supabase.rpc('admin_update_service_catalog',{
      p_service_id:f.dataset.serviceCatalog,
      p_name_ar:String(d.get('name')||'').trim(),
      p_description_ar:String(d.get('description')||'').trim(),
      p_customer_price:+d.get('cp')||0,
      p_official_fee:+d.get('official_fee')||0,
      p_agent_payout:+d.get('ap')||0,
      p_expected_days_min:min,
      p_expected_days_max:max,
      p_active:d.get('active')==='on'
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تم حفظ الخدمة'),reload());
  });

  document.querySelectorAll('[data-req-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(f),b=f.querySelector('button');
    const label=(d.get('label')||'').trim();
    if(!label)return toast('أدخل اسم المتطلب',true);
    busy(b,true);
    const {error}=await supabase.rpc('admin_upsert_service_requirement',{
      p_service_id:f.dataset.reqService,
      p_code:'req_'+Date.now(),
      p_label_ar:label,
      p_requirement_type:d.get('type'),
      p_required:d.get('required')==='on'
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تمت إضافة المتطلب'),reload());
  });

  document.querySelectorAll('[data-requirement]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(f),b=f.querySelector('button:not([type="button"])');
    busy(b,true);
    const {error}=await supabase.rpc('admin_update_service_requirement',{
      p_requirement_id:f.dataset.requirement,
      p_label_ar:String(d.get('label')||'').trim(),
      p_requirement_type:d.get('type'),
      p_required:d.get('required')==='on',
      p_active:true
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تم حفظ المتطلب'),reload());
  });

  document.querySelectorAll('[data-disable-req]').forEach(x=>x.onclick=async()=>{
    const {error}=await supabase.rpc('admin_disable_service_requirement',{p_requirement_id:x.dataset.disableReq});
    error?toast(error.message,true):reload();
  });

  document.querySelectorAll('[data-bundle-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();
    const ids=[...f.querySelectorAll('input[name="item"]:checked')].map(x=>x.value);
    if(!ids.length)return toast('اختر مستنداً واحداً على الأقل داخل الحزمة',true);
    const b=f.querySelector('button');
    busy(b,true);
    const {error}=await supabase.rpc('admin_replace_bundle_items',{
      p_bundle_service_id:f.dataset.bundleService,
      p_item_service_ids:ids
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تم حفظ محتويات الحزمة'),reload());
  });

  document.querySelectorAll('[data-workflow-service]').forEach(x=>x.onchange=async()=>{
    x.disabled=true;
    const {error}=await supabase.rpc('admin_set_service_workflow_step',{
      p_service_id:x.dataset.workflowService,
      p_status:x.dataset.workflowStatus,
      p_active:x.checked,
      p_label_ar:null
    });
    x.disabled=false;
    if(error){
      x.checked=!x.checked;
      toast(error.message,true);
    }else{
      toast('تم تحديث مراحل التنفيذ');
      reload();
    }
  });
}
