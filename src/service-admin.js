import { supabase } from './supabase.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderServicesAdmin(services=[],requirements=[]){
  return services.map(s=>{
    const reqs=requirements.filter(r=>r.service_id===s.id&&r.active);
    return '<div class="serviceadmin">'+
      '<form class="price" data-service="'+s.id+'">'+
        '<b>'+esc(s.name_ar)+'</b>'+
        '<label><small>سعر الخدمة</small><input name="cp" type="number" value="'+Number(s.customer_price||0)+'"></label>'+
        '<label><small>الرسوم الرسمية</small><input name="official_fee" type="number" value="'+Number(s.official_fee||0)+'"></label>'+
        '<label><small>بدل الوكيل</small><input name="ap" type="number" value="'+Number(s.agent_payout||0)+'"></label>'+
        '<label class="check"><input name="active" type="checkbox" '+(s.active?'checked':'')+'> فعّال</label>'+
        '<button class="secondary">حفظ</button>'+
      '</form>'+
      '<div class="reqchips">'+(reqs.length?reqs.map(r=>'<span>'+esc(r.label_ar)+' <button type="button" data-disable-req="'+r.id+'">×</button></span>').join(''):'<small>لا توجد متطلبات.</small>')+'</div>'+
      '<form class="reqadmin" data-req-service="'+s.id+'">'+
        '<input name="label" placeholder="متطلب جديد">'+
        '<select name="type"><option value="file">ملف</option><option value="text">معلومة</option></select>'+
        '<button class="secondary">إضافة</button>'+
      '</form>'+
    '</div>';
  }).join('');
}

export function bindServicesAdmin({toast,busy,reload}){
  document.querySelectorAll('[data-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(f),b=f.querySelector('button');
    busy(b,true);
    const {error}=await supabase.rpc('admin_update_service',{
      p_service_id:f.dataset.service,
      p_customer_price:+d.get('cp'),
      p_agent_payout:+d.get('ap'),
      p_active:d.get('active')==='on',
      p_official_fee:+d.get('official_fee')||0
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تم الحفظ'),reload());
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
      p_required:true
    });
    busy(b,false);
    error?toast(error.message,true):(toast('تمت إضافة المتطلب'),reload());
  });

  document.querySelectorAll('[data-disable-req]').forEach(x=>x.onclick=async()=>{
    const {error}=await supabase.rpc('admin_disable_service_requirement',{p_requirement_id:x.dataset.disableReq});
    error?toast(error.message,true):reload();
  });
}
