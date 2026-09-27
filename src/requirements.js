import { supabase } from './supabase.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderRequirements(reqs=[]){
  if(!reqs.length) return '';
  return '<h3>المطلوب لإكمال الطلب</h3><div class="requirements">'+reqs.map(r=>{
    if(r.completed_at){
      return '<div class="requirement done"><div><b>'+esc(r.label_ar)+'</b><small>تم</small></div><span class="reqdone">✓</span></div>';
    }
    if(r.requirement_type==='file'){
      return '<div class="requirement"><div><b>'+esc(r.label_ar)+'</b><small>مطلوب</small></div><input type="file" id="req-file-'+r.id+'" accept=".pdf,image/*"><button class="secondary compact" data-req-upload="'+r.id+'" data-order-id="'+r.order_id+'">رفع</button></div>';
    }
    return '<div class="requirement"><div><b>'+esc(r.label_ar)+'</b><small>مطلوب</small></div><input id="req-text-'+r.id+'" placeholder="'+esc(r.label_ar)+'"><button class="secondary compact" data-req-save="'+r.id+'" data-order-id="'+r.order_id+'">حفظ</button></div>';
  }).join('')+'</div>';
}

export function bindRequirementActions({toast,busy,reload}){
  document.querySelectorAll('[data-req-upload]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#req-file-'+x.dataset.reqUpload);
    const file=input?.files?.[0];
    if(!file)return toast('اختر الملف المطلوب',true);
    if(file.size>10*1024*1024)return toast('الحد الأقصى للملف 10MB',true);
    busy(x,true,'جارٍ الرفع...');
    const path=x.dataset.orderId+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await supabase.storage.from('order-files').upload(path,file);
    if(up.error){busy(x,false);return toast(up.error.message,true)}
    const ins=await supabase.from('documents').insert({
      order_id:x.dataset.orderId,
      kind:'customer_attachment',
      storage_path:path,
      original_name:file.name,
      mime_type:file.type,
      file_size:file.size,
      visible_to_customer:true,
      uploaded_by:(await supabase.auth.getUser()).data.user?.id
    }).select('id').single();
    if(ins.error){busy(x,false);return toast(ins.error.message,true)}
    const done=await supabase.rpc('complete_order_requirement',{
      p_order_requirement_id:x.dataset.reqUpload,
      p_value_text:null,
      p_document_id:ins.data.id
    });
    busy(x,false);
    done.error?toast(done.error.message,true):(toast('تم رفع المستند'),reload(x.dataset.orderId));
  });

  document.querySelectorAll('[data-req-save]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#req-text-'+x.dataset.reqSave);
    const value=input?.value?.trim();
    if(!value)return toast('أدخل المعلومة المطلوبة',true);
    busy(x,true);
    const {error}=await supabase.rpc('complete_order_requirement',{
      p_order_requirement_id:x.dataset.reqSave,
      p_value_text:value,
      p_document_id:null
    });
    busy(x,false);
    error?toast(error.message,true):(toast('تم الحفظ'),reload(x.dataset.orderId));
  });
}
