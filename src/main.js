import { supabase } from './supabase.js';

const app=document.querySelector('#app');
let session=null,profile=null,services=[],liveChannel=null;

const labels={
  submitted:'تم استلام الطلب',
  accepted:'تم قبول الطلب',
  in_progress:'قيد التجهيز',
  submitted_to_authority:'تم تقديم المعاملة',
  processing:'قيد المعالجة',
  ready_for_collection:'جاهز للاستلام',
  collected:'تم استلام المستند',
  completed:'تم التسليم',
  cancelled:'ملغى'
};
const gov=['بيروت','جبل لبنان','الشمال','عكار','البقاع','بعلبك - الهرمل','الجنوب','النبطية'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'r=>{location.hash=r==='home'?'':r;render()};
const busy=(b,on,t='جارٍ التنفيذ...')=>{if(!b)return;if(on){b.dataset.old=b.textContent;b.textContent=t;b.disabled=true}else{b.textContent=b.dataset.old||b.textContent;b.disabled=false}};

function toast(msg,bad=false){
  let x=document.querySelector('.toast');
  if(!x){x=document.createElement('div');x.className='toast';document.body.appendChild(x)}
  x.textContent=msg;x.className='toast show'+(bad?' bad':'');
  clearTimeout(window.__toast);window.__toast=setTimeout(()=>x.classList.remove('show'),3000);
}
function clearLive(){if(liveChannel){supabase.removeChannel(liveChannel);liveChannel=null}}
function shell(body){
  let right='';
  if(profile?.role==='agent') right=`<button class="toplink withicon" data-go="agent">${icon('briefcase')}<span>بوابة الوكيل</span></button>`;
  else if(profile?.role==='admin') right=`<button class="toplink withicon" data-go="admin">${icon('settings')}<span>الإدارة</span></button>`;
  else right=`<button class="toplink withicon" data-go="orders">${icon('orders')}<span>طلباتي</span></button>`;
  return `<header><button class="brand" data-go="home">عنّك</button>${right}</header><main>${body}</main>`;
}
async function load(){
  const {data:{session:s}}=await supabase.auth.getSession();
  session=s;
  if(!session){
    const {data,error}=await supabase.auth.signInAnonymously();
    if(error){console.error(error);return}
    session=data.session;
  }
  const [{data:p},{data:srv}]=await Promise.all([
    supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle(),
    supabase.from('services').select('*').eq('active',true).order('sort_order')
  ]);
  profile=p;services=srv||[];
}
function home(){
  return shell(`<section class="hero">
    <small>معاملات عقارية في لبنان</small>
    <h1>اطلب أوراق عقارك.<br>ونحن نتابعها عنك.</h1>
    <button class="primary withicon" data-go="new">${icon('plus')}<span>طلب جديد</span></button>
  </section>`);
}
function newOrder(){
  return shell(`<section class="card">
    <div class="title"><h2>طلب جديد</h2><button data-go="home">رجوع</button></div>
    <form id="order">
      <div class="grid">
        <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء">
      </div>
      <div class="grid">
        <input name="cadastral_area" required placeholder="المنطقة العقارية">
        <input name="property_number" required placeholder="رقم العقار">
      </div>
      <div class="services">
        ${services.map(s=>`<label><input type="radio" name="service" value="${s.code}" required><span><b>${icon('file')}${esc(s.name_ar)}</b><em>${money(Number(s.customer_price||0)+Number(s.official_fee||0))}</em></span></label>`).join('')}
      </div>
      <input name="name" value="${esc(profile?.full_name)}" placeholder="الاسم">
      <input name="email" type="email" value="${esc(profile?.email)}" required placeholder="البريد الإلكتروني">
      <input name="phone" value="${esc(profile?.phone)}" required placeholder="رقم الهاتف">
      <textarea name="notes" placeholder="ملاحظة (اختياري)"></textarea>
      <button class="primary full">إرسال الطلب</button>
    </form>
  </section>`);
}
async function orders(){
  clearLive();
  const {data,error}=await supabase.from('orders').select('*').eq('customer_id',session.user.id).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  app.innerHTML=shell(`<section>
    <div class="title"><h2>طلباتي</h2><button data-go="home">رجوع</button></div>
    <div class="stack">${(data||[]).map(o=>`<button class="row" data-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>${labels[o.status]||o.status}</i></button>`).join('')||'<div class="empty">لا يوجد طلبات.</div>'}</div>
    <button class="primary full" data-go="new">طلب جديد</button>
  </section>`);
  bind();
}
async function customerDetail(id){
  clearLive();
  const [{data:o,error},{data:e},{data:d},{data:i},{data:reqs}]=await Promise.all([
    supabase.from('orders').select('*').eq('id',id).single(),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).eq('visible_to_customer',true).order('created_at'),
    supabase.from('order_items').select('*').eq('order_id',id),
    supabase.from('order_requirements').select('*').eq('order_id',id).order('created_at')
  ]);
  if(error)return toast(error.message,true);
  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>${o.public_code}</h2><button data-go="orders">رجوع</button></div>
    <div class="summary">
      <b>${esc(o.cadastral_area)} • عقار ${esc(o.property_number)}</b>
      <span>${(i||[]).map(x=>esc(x.service_name_ar)).join('، ')}</span>
      <strong>${money(o.total_amount)}</strong>
    </div>
    ${(reqs||[]).length?`<h3 class="sectionicon">${icon('file')}<span>المطلوب لإتمام الطلب</span></h3>
    <div class="requirements">${reqs.map(r=>`<div class="requirement ${r.completed_at?'done':''}">
      <div><b>${esc(r.label_ar)}</b><small>${r.completed_at?'تم':'مطلوب'}</small></div>
      ${r.completed_at?`<span class="reqdone">${icon('check')}</span>`:r.requirement_type==='file'?`
        <input type="file" id="req-file-${r.id}" accept=".pdf,image/*">
        <button class="secondary compact withicon" data-req-upload="${r.id}" data-order-id="${o.id}">${icon('upload')}<span>رفع</span></button>`
        :`<input id="req-text-${r.id}" placeholder="${esc(r.label_ar)}"><button class="secondary compact" data-req-save="${r.id}">حفظ</button>`}
    </div>`).join('')}</div>`:''}

    <h3 class="sectionicon">${icon('clock')}<span>التتبّع</span></h3>
    <div class="timeline">${(e||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>
    ${(d||[]).map(x=>`<button class="download full" data-download="${esc(x.storage_path)}">${esc(x.original_name||'فتح المستند')}</button>`).join('')}
    ${o.status==='submitted'?`<button class="danger full" data-cancel="${o.id}">إلغاء الطلب</button>`:''}
  </section>`);
  bind();
  liveChannel=supabase.channel('customer-order-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>customerDetail(id))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`id=eq.${id}`},()=>customerDetail(id))
    .subscribe();
}
async function agentPortal(){
  clearLive();
  const {data:a}=await supabase.from('agent_profiles').select('*').eq('user_id',session.user.id).maybeSingle();

  if(!a){
    app.innerHTML=shell(`<section class="card narrow">
      <div class="title"><h2>التسجيل كوكيل</h2><button data-go="home">رجوع</button></div>
      <form id="agentJoin">
        <input name="name" value="${esc(profile?.full_name)}" required placeholder="الاسم">
        <input name="email" type="email" value="${esc(profile?.email)}" required placeholder="البريد الإلكتروني">
        <input name="phone" value="${esc(profile?.phone)}" required placeholder="رقم الهاتف">
        <select name="governorate" required><option value="">منطقة العمل</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء (اختياري)">
        <button class="primary full">إرسال طلب الوكيل</button>
      </form>
    </section>`);
    return bind();
  }

  if(a.verification_status!=='approved'){
    app.innerHTML=shell(`<section class="card narrow pending">
      <h2>طلب الوكيل</h2>
      <div class="statusbig">قيد المراجعة</div>
      <p>سنفعّل حسابك بعد الاعتماد.</p>
    </section>`);
    return bind();
  }

  await supabase.rpc('refresh_agent_dispatch');
  const [{data:available},{data:mine},{data:completed},{data:coverage},{data:balance}]=await Promise.all([
    supabase.rpc('list_available_orders'),
    supabase.from('orders').select('*').eq('assigned_agent_id',session.user.id).not('status','in','("completed","cancelled")').order('accepted_at',{ascending:false}),
    supabase.from('orders').select('*').eq('assigned_agent_id',session.user.id).eq('status','completed').order('completed_at',{ascending:false}).limit(20),
    supabase.from('agent_coverage').select('*').eq('agent_id',session.user.id).eq('active',true),
    supabase.rpc('get_agent_balance')
  ]);
  const bal=balance?.[0]||{pending:0,available:0};

  app.innerHTML=shell(`<section>
    <div class="agentbar">
      <div class="balancebox">${icon('wallet')}<span><small>الرصيد المتاح</small><strong>${money(bal.available)}</strong></span></div>
      <label class="availability"><input id="agentAvailable" type="checkbox" ${a.available?'checked':''}><span>${a.available?'متاح':'غير متاح'}</span></label>
    </div>

    <h3 class="sectionicon">${icon('briefcase')}<span>طلباتي الحالية</span></h3>
    <div class="stack">${(mine||[]).map(o=>`<button class="row" data-agent-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>${labels[o.status]}</i></button>`).join('')||'<div class="empty">لا يوجد طلبات حالية.</div>'}</div>

    <h3 class="sectionicon">${icon('plus')}<span>طلبات متاحة</span></h3>
    <div class="stack">${(available||[]).map(o=>`<div class="job">
      <span><b>${esc(o.service_names)}</b><small>${esc(o.governorate)}${o.district?' • '+esc(o.district):''} • ${esc(o.cadastral_area)}</small></span>
      <strong>${money(o.agent_payout)}</strong>
      <button class="primary" data-accept="${o.id}">قبول</button>
    </div>`).join('')||'<div class="empty">لا يوجد طلبات متاحة حالياً.</div>'}</div>

    <h3 class="sectionicon">${icon('check')}<span>طلبات مكتملة</span></h3>
    <div class="stack">${(completed||[]).map(o=>`<button class="row" data-agent-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>تم التسليم</i></button>`).join('')||'<div class="empty">لا يوجد طلبات مكتملة بعد.</div>'}</div>

    <details class="coverage">
      <summary class="withicon">${icon('map')}<span>مناطق العمل</span></summary>
      <form id="coverage">
        <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء (اختياري)">
        <button class="secondary">إضافة</button>
      </form>
      <small>${(coverage||[]).map(x=>esc(x.governorate)+(x.district?' / '+esc(x.district):'')).join('، ')||'لم تضف مناطق بعد.'}</small>
    </details>
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-feed-'+session.user.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'dispatch_offers',filter:`agent_id=eq.${session.user.id}`},()=>{
      toast('طلب جديد متاح');agentPortal();
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`assigned_agent_id=eq.${session.user.id}`},()=>agentPortal())
    .subscribe();
}
async function agentJob(id){
  clearLive();
  const [{data:rows,error},{data:events},{data:docs}]=await Promise.all([
    supabase.rpc('get_agent_job',{p_order_id:id}),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).order('created_at')
  ]);
  const o=rows?.[0];
  if(error||!o)return toast(error?.message||'تعذر فتح الطلب',true);
  const next={
    accepted:['in_progress','بدء العمل'],
    in_progress:['submitted_to_authority','تم تقديم المعاملة'],
    submitted_to_authority:['processing','قيد المعالجة'],
    processing:['ready_for_collection','جاهز للاستلام'],
    ready_for_collection:['collected','تم استلام المستند'],
    collected:['completed','إكمال الطلب']
  }[o.status];

  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>${o.public_code}</h2><button data-go="agent">رجوع</button></div>

    <div class="jobinfo">
      <div><small>الخدمة</small><b>${esc(o.service_names)}</b></div>
      <div><small>العقار</small><b>${esc(o.cadastral_area)} • ${esc(o.property_number)}</b></div>
      <div><small>بدلك</small><b>${money(o.agent_payout)}</b></div>
      <div><small>العميل</small><b>${esc(o.customer_name||'—')}</b></div>
      <div><small>الهاتف</small><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone||'—')}</a></div>
      ${o.notes?`<div class="wide"><small>ملاحظة</small><b>${esc(o.notes)}</b></div>`:''}
    </div>

    <h3 class="sectionicon">${icon('clock')}<span>التتبّع</span></h3>
    <div class="timeline">${(events||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>

    <div class="uploadbox">
      <input id="jobFile" type="file" accept=".pdf,image/*">
      <label class="check"><input id="visibleToCustomer" type="checkbox"> يظهر للعميل</label>
      <button class="secondary full withicon" data-upload="${o.id}">${icon('upload')}<span>رفع الملف النهائي</span></button>
      ${(docs||[]).length?`<small>${docs.length} ملف مرفوع</small>`:''}
    </div>

    ${next?`<button class="primary full next-action" data-status="${next[0]}" data-id="${o.id}">${next[1]}</button>`:'<div class="donebox">تم إكمال الطلب</div>'}
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-job-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>agentJob(id))
    .subscribe();
}
async function admin(){
  clearLive();
  if(profile?.role!=='admin')return go('home');
  const [{data:a},{data:s},{data:o}]=await Promise.all([
    supabase.from('agent_profiles').select('*').order('created_at',{ascending:false}),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(50)
  ]);
  const ids=(a||[]).map(x=>x.user_id),names={};
  if(ids.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',ids);
    (p||[]).forEach(x=>names[x.id]=x);
  }
  app.innerHTML=shell(`<section>
    <div class="title"><h2>الإدارة</h2><button data-go="home">رجوع</button></div>
    <h3 class="sectionicon">${icon('user')}<span>الوكلاء</span></h3>
    <div class="stack">${(a||[]).map(x=>`<div class="adminrow"><span><b>${esc(names[x.user_id]?.full_name||names[x.user_id]?.email||x.user_id)}</b><small>${x.verification_status}</small></span>${x.verification_status==='approved'?`<button class="danger" data-suspend="${x.user_id}">تعليق</button>`:`<button class="primary" data-approve="${x.user_id}">اعتماد</button>`}</div>`).join('')||'<div class="empty">لا يوجد.</div>'}</div>
    <h3 class="sectionicon">${icon('settings')}<span>الخدمات والأسعار</span></h3>
    <div class="stack">${(s||[]).map(x=>`<div class="serviceadmin"><form class="price" data-service="${x.id}"><b>${esc(x.name_ar)}</b><label>سعر الخدمة<input name="cp" type="number" value="${x.customer_price}"></label><label>الرسوم الرسمية<input name="official_fee" type="number" value="${x.official_fee||0}"></label><label>بدل الوكيل<input name="ap" type="number" value="${x.agent_payout}"></label><label class="check"><input name="active" type="checkbox" ${x.active?'checked':''}> فعّال</label><button class="secondary">حفظ</button></form><form class="reqadmin" data-req-service="${x.id}"><input name="label" placeholder="مستند أو معلومة مطلوبة"><select name="type"><option value="file">ملف</option><option value="text">معلومة</option></select><button class="secondary withicon">${icon('plus')}<span>إضافة متطلب</span></button></form></div>`).join('')}</div>
    <h3>آخر الطلبات</h3>
    <div class="stack">${(o||[]).map(x=>`<div class="adminrow"><b>${x.public_code}</b><i>${labels[x.status]}</i></div>`).join('')}</div>
  </section>`);
  bind();
}
function render(){
  if(!session){
    app.innerHTML=shell('<section class="card narrow"><h2>جارٍ تجهيز الجلسة...</h2></section>');
    return bind();
  }
  const r=location.hash.slice(1)||'home';
  if(r==='new')app.innerHTML=newOrder();
  else if(r==='orders')return orders();
  else if(r==='agent')return agentPortal();
  else if(r==='admin')return admin();
  else app.innerHTML=home();
  bind();
}
function bind(){
  document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>go(x.dataset.go));

  const order=document.querySelector('#order');
  if(order)order.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(order),b=order.querySelector('button');busy(b,true);
    const contact=await supabase.rpc('update_my_profile',{p_full_name:f.get('name')||'',p_phone:f.get('phone')||'',p_locale:'ar',p_email:f.get('email')||''});
    if(contact.error){busy(b,false);return toast(contact.error.message,true)}
    profile=contact.data;
    const {data,error}=await supabase.rpc('create_order',{
      p_customer_name:f.get('name')||'',p_customer_phone:f.get('phone'),p_customer_email:f.get('email')||'',
      p_governorate:f.get('governorate'),p_district:f.get('district')||'',p_cadastral_area:f.get('cadastral_area'),
      p_property_number:f.get('property_number'),p_property_section:'',p_notes:f.get('notes')||'',p_service_codes:[f.get('service')]
    });
    busy(b,false);
    if(error)toast(error.message,true);
    else {toast('تم إنشاء الطلب');customerDetail(data?.[0]?.order_id)}
  };

  const join=document.querySelector('#agentJoin');
  if(join)join.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(join),b=join.querySelector('button');busy(b,true);
    const contact=await supabase.rpc('update_my_profile',{p_full_name:f.get('name'),p_phone:f.get('phone'),p_locale:'ar',p_email:f.get('email')});
    if(contact.error){busy(b,false);return toast(contact.error.message,true)}
    const applied=await supabase.rpc('apply_as_agent');
    if(applied.error){busy(b,false);return toast(applied.error.message,true)}
    const coverage=await supabase.rpc('replace_agent_coverage',{p_governorate:f.get('governorate'),p_district:f.get('district')||''});
    busy(b,false);
    if(coverage.error)return toast(coverage.error.message,true);
    await load();toast('تم إرسال طلب الوكيل');agentPortal();
  };

  const av=document.querySelector('#agentAvailable');
  if(av)av.onchange=async()=>{
    const {error}=await supabase.rpc('set_agent_availability',{p_available:av.checked});
    if(error){av.checked=!av.checked;toast(error.message,true)} else agentPortal();
  };

  const coverage=document.querySelector('#coverage');
  if(coverage)coverage.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(coverage),b=coverage.querySelector('button');busy(b,true);
    const {error}=await supabase.rpc('replace_agent_coverage',{p_governorate:f.get('governorate'),p_district:f.get('district')||''});
    busy(b,false);error?toast(error.message,true):(toast('تمت الإضافة'),agentPortal());
  };

  document.querySelectorAll('[data-order]').forEach(x=>x.onclick=()=>customerDetail(x.dataset.order));

  document.querySelectorAll('[data-req-upload]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#req-file-'+x.dataset.reqUpload);
    const file=input?.files?.[0];
    if(!file)return toast('اختر الملف المطلوب',true);
    busy(x,true,'جارٍ الرفع...');
    const path=x.dataset.orderId+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await supabase.storage.from('order-files').upload(path,file);
    if(up.error){busy(x,false);return toast(up.error.message,true)}
    const ins=await supabase.from('documents').insert({
      order_id:x.dataset.orderId,kind:'customer_attachment',storage_path:path,original_name:file.name,
      mime_type:file.type,file_size:file.size,visible_to_customer:true,uploaded_by:session.user.id
    }).select('id').single();
    if(ins.error){busy(x,false);return toast(ins.error.message,true)}
    const done=await supabase.rpc('complete_order_requirement',{p_order_requirement_id:x.dataset.reqUpload,p_value_text:null,p_document_id:ins.data.id});
    busy(x,false);done.error?toast(done.error.message,true):(toast('تم رفع المستند'),customerDetail(x.dataset.orderId));
  });

  document.querySelectorAll('[data-req-save]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#req-text-'+x.dataset.reqSave);
    const value=input?.value?.trim();
    if(!value)return toast('أدخل المعلومة المطلوبة',true);
    busy(x,true);
    const {error}=await supabase.rpc('complete_order_requirement',{p_order_requirement_id:x.dataset.reqSave,p_value_text:value,p_document_id:null});
    busy(x,false);error?toast(error.message,true):customerDetail(x.closest('.card')?.querySelector('[data-cancel]')?.dataset.cancel || location.hash.split('/').pop());
  });
  document.querySelectorAll('[data-agent-order]').forEach(x=>x.onclick=()=>agentJob(x.dataset.agentOrder));

  document.querySelectorAll('[data-accept]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('accept_order',{p_order_id:x.dataset.accept});
    if(error){busy(x,false);return toast(error.message==='order_unavailable'?'تم أخذ الطلب من وكيل آخر':error.message,true)}
    toast('أصبح الطلب لك');agentJob(x.dataset.accept);
  });

  document.querySelectorAll('[data-status]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('update_order_status',{p_order_id:x.dataset.id,p_status:x.dataset.status,p_note:''});
    if(error){busy(x,false);toast(error.message,true)}else{toast('تم تحديث الحالة');agentJob(x.dataset.id)}
  });

  document.querySelectorAll('[data-upload]').forEach(x=>x.onclick=async()=>{
    const f=document.querySelector('#jobFile')?.files?.[0];
    if(!f)return toast('اختر ملفاً أولاً',true);
    busy(x,true,'جارٍ الرفع...');
    const path=x.dataset.upload+'/'+crypto.randomUUID()+'-'+f.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await supabase.storage.from('order-files').upload(path,f);
    if(up.error){busy(x,false);return toast(up.error.message,true)}
    const {error}=await supabase.from('documents').insert({
      order_id:x.dataset.upload,kind:'final_document',storage_path:path,original_name:f.name,
      mime_type:f.type,file_size:f.size,visible_to_customer:document.querySelector('#visibleToCustomer')?.checked||false,
      uploaded_by:session.user.id
    });
    busy(x,false);error?toast(error.message,true):(toast('تم رفع الملف'),agentJob(x.dataset.upload));
  });

  document.querySelectorAll('[data-download]').forEach(x=>x.onclick=async()=>{
    const {data,error}=await supabase.storage.from('order-files').download(x.dataset.download);
    if(error)return toast(error.message,true);
    const u=URL.createObjectURL(data);window.open(u,'_blank');setTimeout(()=>URL.revokeObjectURL(u),60000);
  });

  document.querySelectorAll('[data-cancel]').forEach(x=>x.onclick=async()=>{
    if(!confirm('إلغاء الطلب؟'))return;
    const {error}=await supabase.rpc('cancel_own_order',{p_order_id:x.dataset.cancel});
    error?toast(error.message,true):(toast('تم إلغاء الطلب'),go('orders'));
  });

  document.querySelectorAll('[data-approve]').forEach(x=>x.onclick=()=>agentStatus(x.dataset.approve,'approved'));
  document.querySelectorAll('[data-suspend]').forEach(x=>x.onclick=()=>agentStatus(x.dataset.suspend,'suspended'));
  document.querySelectorAll('[data-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();const d=new FormData(f),b=f.querySelector('button');busy(b,true);
    const {error}=await supabase.rpc('admin_update_service',{p_service_id:f.dataset.service,p_customer_price:+d.get('cp'),p_agent_payout:+d.get('ap'),p_active:d.get('active')==='on',p_official_fee:+d.get('official_fee')||0});
    busy(b,false);error?toast(error.message,true):toast('تم الحفظ');
  });

  document.querySelectorAll('[data-req-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();const d=new FormData(f),b=f.querySelector('button');
    const label=(d.get('label')||'').trim();if(!label)return toast('أدخل اسم المتطلب',true);
    busy(b,true);
    const code='req_'+Date.now();
    const {error}=await supabase.rpc('admin_upsert_service_requirement',{
      p_service_id:f.dataset.reqService,p_code:code,p_label_ar:label,p_requirement_type:d.get('type'),p_required:true
    });
    busy(b,false);error?toast(error.message,true):(toast('تمت إضافة المتطلب'),admin());
  });
}
async function agentStatus(id,status){
  const {error}=await supabase.rpc('admin_set_agent_status',{p_agent_id:id,p_status:status});
  error?toast(error.message,true):admin();
}

window.addEventListener('hashchange',render);

try {
  await load();
  render();
} catch (err) {
  console.error(err);
  app.innerHTML='<main><section class="card narrow"><h2>تعذر فتح الصفحة</h2><p>حدّث الصفحة وحاول مرة أخرى.</p></section></main>';
}+Number(v||0).toFixed(0);
const icon=(name)=>({
  plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  orders:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/></svg>',
  file:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l3 3v15H7zM14 3v4h4"/></svg>',
  upload:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4M5 19h14"/></svg>',
  check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6"/></svg>',
  wallet:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v11H4zM4 7l2-3h11l3 3M15 12h5"/></svg>',
  briefcase:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11H4zM9 8V5h6v3M4 12h16"/></svg>',
  map:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>',
  clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  user:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/></svg>',
  settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>'
}[name]||'');
const go=r=>{location.hash=r==='home'?'':r;render()};
const busy=(b,on,t='جارٍ التنفيذ...')=>{if(!b)return;if(on){b.dataset.old=b.textContent;b.textContent=t;b.disabled=true}else{b.textContent=b.dataset.old||b.textContent;b.disabled=false}};

function toast(msg,bad=false){
  let x=document.querySelector('.toast');
  if(!x){x=document.createElement('div');x.className='toast';document.body.appendChild(x)}
  x.textContent=msg;x.className='toast show'+(bad?' bad':'');
  clearTimeout(window.__toast);window.__toast=setTimeout(()=>x.classList.remove('show'),3000);
}
function clearLive(){if(liveChannel){supabase.removeChannel(liveChannel);liveChannel=null}}
function shell(body){
  let right='';
  if(profile?.role==='agent') right=`<button class="toplink withicon" data-go="agent">${icon('briefcase')}<span>بوابة الوكيل</span></button>`;
  else if(profile?.role==='admin') right=`<button class="toplink withicon" data-go="admin">${icon('settings')}<span>الإدارة</span></button>`;
  else right=`<button class="toplink withicon" data-go="orders">${icon('orders')}<span>طلباتي</span></button>`;
  return `<header><button class="brand" data-go="home">عنّك</button>${right}</header><main>${body}</main>`;
}
async function load(){
  const {data:{session:s}}=await supabase.auth.getSession();
  session=s;
  if(!session){
    const {data,error}=await supabase.auth.signInAnonymously();
    if(error){console.error(error);return}
    session=data.session;
  }
  const [{data:p},{data:srv}]=await Promise.all([
    supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle(),
    supabase.from('services').select('*').eq('active',true).order('sort_order')
  ]);
  profile=p;services=srv||[];
}
function home(){
  return shell(`<section class="hero">
    <small>معاملات عقارية في لبنان</small>
    <h1>اطلب أوراق عقارك.<br>ونحن نتابعها عنك.</h1>
    <button class="primary withicon" data-go="new">${icon('plus')}<span>طلب جديد</span></button>
  </section>`);
}
function newOrder(){
  return shell(`<section class="card">
    <div class="title"><h2>طلب جديد</h2><button data-go="home">رجوع</button></div>
    <form id="order">
      <div class="grid">
        <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء">
      </div>
      <div class="grid">
        <input name="cadastral_area" required placeholder="المنطقة العقارية">
        <input name="property_number" required placeholder="رقم العقار">
      </div>
      <div class="services">
        ${services.map(s=>`<label><input type="radio" name="service" value="${s.code}" required><span><b>${icon('file')}${esc(s.name_ar)}</b><em>${money(Number(s.customer_price||0)+Number(s.official_fee||0))}</em></span></label>`).join('')}
      </div>
      <input name="name" value="${esc(profile?.full_name)}" placeholder="الاسم">
      <input name="email" type="email" value="${esc(profile?.email)}" required placeholder="البريد الإلكتروني">
      <input name="phone" value="${esc(profile?.phone)}" required placeholder="رقم الهاتف">
      <textarea name="notes" placeholder="ملاحظة (اختياري)"></textarea>
      <button class="primary full">إرسال الطلب</button>
    </form>
  </section>`);
}
async function orders(){
  clearLive();
  const {data,error}=await supabase.from('orders').select('*').eq('customer_id',session.user.id).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  app.innerHTML=shell(`<section>
    <div class="title"><h2>طلباتي</h2><button data-go="home">رجوع</button></div>
    <div class="stack">${(data||[]).map(o=>`<button class="row" data-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>${labels[o.status]||o.status}</i></button>`).join('')||'<div class="empty">لا يوجد طلبات.</div>'}</div>
    <button class="primary full" data-go="new">طلب جديد</button>
  </section>`);
  bind();
}
async function customerDetail(id){
  clearLive();
  const [{data:o,error},{data:e},{data:d},{data:i},{data:reqs}]=await Promise.all([
    supabase.from('orders').select('*').eq('id',id).single(),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).eq('visible_to_customer',true).order('created_at'),
    supabase.from('order_items').select('*').eq('order_id',id),
    supabase.from('order_requirements').select('*').eq('order_id',id).order('created_at')
  ]);
  if(error)return toast(error.message,true);
  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>${o.public_code}</h2><button data-go="orders">رجوع</button></div>
    <div class="summary">
      <b>${esc(o.cadastral_area)} • عقار ${esc(o.property_number)}</b>
      <span>${(i||[]).map(x=>esc(x.service_name_ar)).join('، ')}</span>
      <strong>${money(o.total_amount)}</strong>
    </div>
    ${(reqs||[]).length?`<h3 class="sectionicon">${icon('file')}<span>المطلوب لإتمام الطلب</span></h3>
    <div class="requirements">${reqs.map(r=>`<div class="requirement ${r.completed_at?'done':''}">
      <div><b>${esc(r.label_ar)}</b><small>${r.completed_at?'تم':'مطلوب'}</small></div>
      ${r.completed_at?`<span class="reqdone">${icon('check')}</span>`:r.requirement_type==='file'?`
        <input type="file" id="req-file-${r.id}" accept=".pdf,image/*">
        <button class="secondary compact withicon" data-req-upload="${r.id}" data-order-id="${o.id}">${icon('upload')}<span>رفع</span></button>`
        :`<input id="req-text-${r.id}" placeholder="${esc(r.label_ar)}"><button class="secondary compact" data-req-save="${r.id}">حفظ</button>`}
    </div>`).join('')}</div>`:''}

    <h3 class="sectionicon">${icon('clock')}<span>التتبّع</span></h3>
    <div class="timeline">${(e||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>
    ${(d||[]).map(x=>`<button class="download full" data-download="${esc(x.storage_path)}">${esc(x.original_name||'فتح المستند')}</button>`).join('')}
    ${o.status==='submitted'?`<button class="danger full" data-cancel="${o.id}">إلغاء الطلب</button>`:''}
  </section>`);
  bind();
  liveChannel=supabase.channel('customer-order-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>customerDetail(id))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`id=eq.${id}`},()=>customerDetail(id))
    .subscribe();
}
async function agentPortal(){
  clearLive();
  const {data:a}=await supabase.from('agent_profiles').select('*').eq('user_id',session.user.id).maybeSingle();

  if(!a){
    app.innerHTML=shell(`<section class="card narrow">
      <div class="title"><h2>التسجيل كوكيل</h2><button data-go="home">رجوع</button></div>
      <form id="agentJoin">
        <input name="name" value="${esc(profile?.full_name)}" required placeholder="الاسم">
        <input name="email" type="email" value="${esc(profile?.email)}" required placeholder="البريد الإلكتروني">
        <input name="phone" value="${esc(profile?.phone)}" required placeholder="رقم الهاتف">
        <select name="governorate" required><option value="">منطقة العمل</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء (اختياري)">
        <button class="primary full">إرسال طلب الوكيل</button>
      </form>
    </section>`);
    return bind();
  }

  if(a.verification_status!=='approved'){
    app.innerHTML=shell(`<section class="card narrow pending">
      <h2>طلب الوكيل</h2>
      <div class="statusbig">قيد المراجعة</div>
      <p>سنفعّل حسابك بعد الاعتماد.</p>
    </section>`);
    return bind();
  }

  await supabase.rpc('refresh_agent_dispatch');
  const [{data:available},{data:mine},{data:completed},{data:coverage},{data:balance}]=await Promise.all([
    supabase.rpc('list_available_orders'),
    supabase.from('orders').select('*').eq('assigned_agent_id',session.user.id).not('status','in','("completed","cancelled")').order('accepted_at',{ascending:false}),
    supabase.from('orders').select('*').eq('assigned_agent_id',session.user.id).eq('status','completed').order('completed_at',{ascending:false}).limit(20),
    supabase.from('agent_coverage').select('*').eq('agent_id',session.user.id).eq('active',true),
    supabase.rpc('get_agent_balance')
  ]);
  const bal=balance?.[0]||{pending:0,available:0};

  app.innerHTML=shell(`<section>
    <div class="agentbar">
      <div class="balancebox">${icon('wallet')}<span><small>الرصيد المتاح</small><strong>${money(bal.available)}</strong></span></div>
      <label class="availability"><input id="agentAvailable" type="checkbox" ${a.available?'checked':''}><span>${a.available?'متاح':'غير متاح'}</span></label>
    </div>

    <h3 class="sectionicon">${icon('briefcase')}<span>طلباتي الحالية</span></h3>
    <div class="stack">${(mine||[]).map(o=>`<button class="row" data-agent-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>${labels[o.status]}</i></button>`).join('')||'<div class="empty">لا يوجد طلبات حالية.</div>'}</div>

    <h3 class="sectionicon">${icon('plus')}<span>طلبات متاحة</span></h3>
    <div class="stack">${(available||[]).map(o=>`<div class="job">
      <span><b>${esc(o.service_names)}</b><small>${esc(o.governorate)}${o.district?' • '+esc(o.district):''} • ${esc(o.cadastral_area)}</small></span>
      <strong>${money(o.agent_payout)}</strong>
      <button class="primary" data-accept="${o.id}">قبول</button>
    </div>`).join('')||'<div class="empty">لا يوجد طلبات متاحة حالياً.</div>'}</div>

    <details class="coverage">
      <summary class="withicon">${icon('map')}<span>مناطق العمل</span></summary>
      <form id="coverage">
        <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء (اختياري)">
        <button class="secondary">إضافة</button>
      </form>
      <small>${(coverage||[]).map(x=>esc(x.governorate)+(x.district?' / '+esc(x.district):'')).join('، ')||'لم تضف مناطق بعد.'}</small>
    </details>
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-feed-'+session.user.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'dispatch_offers',filter:`agent_id=eq.${session.user.id}`},()=>{
      toast('طلب جديد متاح');agentPortal();
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`assigned_agent_id=eq.${session.user.id}`},()=>agentPortal())
    .subscribe();
}
async function agentJob(id){
  clearLive();
  const [{data:rows,error},{data:events},{data:docs}]=await Promise.all([
    supabase.rpc('get_agent_job',{p_order_id:id}),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).order('created_at')
  ]);
  const o=rows?.[0];
  if(error||!o)return toast(error?.message||'تعذر فتح الطلب',true);
  const next={
    accepted:['in_progress','بدء العمل'],
    in_progress:['submitted_to_authority','تم تقديم المعاملة'],
    submitted_to_authority:['processing','قيد المعالجة'],
    processing:['ready_for_collection','جاهز للاستلام'],
    ready_for_collection:['collected','تم استلام المستند'],
    collected:['completed','إكمال الطلب']
  }[o.status];

  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>${o.public_code}</h2><button data-go="agent">رجوع</button></div>

    <div class="jobinfo">
      <div><small>الخدمة</small><b>${esc(o.service_names)}</b></div>
      <div><small>العقار</small><b>${esc(o.cadastral_area)} • ${esc(o.property_number)}</b></div>
      <div><small>بدلك</small><b>${money(o.agent_payout)}</b></div>
      <div><small>العميل</small><b>${esc(o.customer_name||'—')}</b></div>
      <div><small>الهاتف</small><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone||'—')}</a></div>
      ${o.notes?`<div class="wide"><small>ملاحظة</small><b>${esc(o.notes)}</b></div>`:''}
    </div>

    <h3 class="sectionicon">${icon('clock')}<span>التتبّع</span></h3>
    <div class="timeline">${(events||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>

    <div class="uploadbox">
      <input id="jobFile" type="file" accept=".pdf,image/*">
      <label class="check"><input id="visibleToCustomer" type="checkbox"> يظهر للعميل</label>
      <button class="secondary full withicon" data-upload="${o.id}">${icon('upload')}<span>رفع الملف النهائي</span></button>
      ${(docs||[]).length?`<small>${docs.length} ملف مرفوع</small>`:''}
    </div>

    ${next?`<button class="primary full next-action" data-status="${next[0]}" data-id="${o.id}">${next[1]}</button>`:'<div class="donebox">تم إكمال الطلب</div>'}
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-job-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>agentJob(id))
    .subscribe();
}
async function admin(){
  clearLive();
  if(profile?.role!=='admin')return go('home');
  const [{data:a},{data:s},{data:o}]=await Promise.all([
    supabase.from('agent_profiles').select('*').order('created_at',{ascending:false}),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(50)
  ]);
  const ids=(a||[]).map(x=>x.user_id),names={};
  if(ids.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',ids);
    (p||[]).forEach(x=>names[x.id]=x);
  }
  app.innerHTML=shell(`<section>
    <div class="title"><h2>الإدارة</h2><button data-go="home">رجوع</button></div>
    <h3 class="sectionicon">${icon('user')}<span>الوكلاء</span></h3>
    <div class="stack">${(a||[]).map(x=>`<div class="adminrow"><span><b>${esc(names[x.user_id]?.full_name||names[x.user_id]?.email||x.user_id)}</b><small>${x.verification_status}</small></span>${x.verification_status==='approved'?`<button class="danger" data-suspend="${x.user_id}">تعليق</button>`:`<button class="primary" data-approve="${x.user_id}">اعتماد</button>`}</div>`).join('')||'<div class="empty">لا يوجد.</div>'}</div>
    <h3 class="sectionicon">${icon('settings')}<span>الخدمات والأسعار</span></h3>
    <div class="stack">${(s||[]).map(x=>`<div class="serviceadmin"><form class="price" data-service="${x.id}"><b>${esc(x.name_ar)}</b><label>سعر الخدمة<input name="cp" type="number" value="${x.customer_price}"></label><label>الرسوم الرسمية<input name="official_fee" type="number" value="${x.official_fee||0}"></label><label>بدل الوكيل<input name="ap" type="number" value="${x.agent_payout}"></label><label class="check"><input name="active" type="checkbox" ${x.active?'checked':''}> فعّال</label><button class="secondary">حفظ</button></form><form class="reqadmin" data-req-service="${x.id}"><input name="label" placeholder="مستند أو معلومة مطلوبة"><select name="type"><option value="file">ملف</option><option value="text">معلومة</option></select><button class="secondary withicon">${icon('plus')}<span>إضافة متطلب</span></button></form></div>`).join('')}</div>
    <h3>آخر الطلبات</h3>
    <div class="stack">${(o||[]).map(x=>`<div class="adminrow"><b>${x.public_code}</b><i>${labels[x.status]}</i></div>`).join('')}</div>
  </section>`);
  bind();
}
function render(){
  if(!session){
    app.innerHTML=shell('<section class="card narrow"><h2>جارٍ تجهيز الجلسة...</h2></section>');
    return bind();
  }
  const r=location.hash.slice(1)||'home';
  if(r==='new')app.innerHTML=newOrder();
  else if(r==='orders')return orders();
  else if(r==='agent')return agentPortal();
  else if(r==='admin')return admin();
  else app.innerHTML=home();
  bind();
}
function bind(){
  document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>go(x.dataset.go));

  const order=document.querySelector('#order');
  if(order)order.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(order),b=order.querySelector('button');busy(b,true);
    const contact=await supabase.rpc('update_my_profile',{p_full_name:f.get('name')||'',p_phone:f.get('phone')||'',p_locale:'ar',p_email:f.get('email')||''});
    if(contact.error){busy(b,false);return toast(contact.error.message,true)}
    profile=contact.data;
    const {data,error}=await supabase.rpc('create_order',{
      p_customer_name:f.get('name')||'',p_customer_phone:f.get('phone'),p_customer_email:f.get('email')||'',
      p_governorate:f.get('governorate'),p_district:f.get('district')||'',p_cadastral_area:f.get('cadastral_area'),
      p_property_number:f.get('property_number'),p_property_section:'',p_notes:f.get('notes')||'',p_service_codes:[f.get('service')]
    });
    busy(b,false);
    if(error)toast(error.message,true);
    else {toast('تم إنشاء الطلب');customerDetail(data?.[0]?.order_id)}
  };

  const join=document.querySelector('#agentJoin');
  if(join)join.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(join),b=join.querySelector('button');busy(b,true);
    const contact=await supabase.rpc('update_my_profile',{p_full_name:f.get('name'),p_phone:f.get('phone'),p_locale:'ar',p_email:f.get('email')});
    if(contact.error){busy(b,false);return toast(contact.error.message,true)}
    const applied=await supabase.rpc('apply_as_agent');
    if(applied.error){busy(b,false);return toast(applied.error.message,true)}
    const coverage=await supabase.rpc('replace_agent_coverage',{p_governorate:f.get('governorate'),p_district:f.get('district')||''});
    busy(b,false);
    if(coverage.error)return toast(coverage.error.message,true);
    await load();toast('تم إرسال طلب الوكيل');agentPortal();
  };

  const av=document.querySelector('#agentAvailable');
  if(av)av.onchange=async()=>{
    const {error}=await supabase.rpc('set_agent_availability',{p_available:av.checked});
    if(error){av.checked=!av.checked;toast(error.message,true)} else agentPortal();
  };

  const coverage=document.querySelector('#coverage');
  if(coverage)coverage.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(coverage),b=coverage.querySelector('button');busy(b,true);
    const {error}=await supabase.rpc('replace_agent_coverage',{p_governorate:f.get('governorate'),p_district:f.get('district')||''});
    busy(b,false);error?toast(error.message,true):(toast('تمت الإضافة'),agentPortal());
  };

  document.querySelectorAll('[data-order]').forEach(x=>x.onclick=()=>customerDetail(x.dataset.order));

  document.querySelectorAll('[data-req-upload]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#req-file-'+x.dataset.reqUpload);
    const file=input?.files?.[0];
    if(!file)return toast('اختر الملف المطلوب',true);
    busy(x,true,'جارٍ الرفع...');
    const path=x.dataset.orderId+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await supabase.storage.from('order-files').upload(path,file);
    if(up.error){busy(x,false);return toast(up.error.message,true)}
    const ins=await supabase.from('documents').insert({
      order_id:x.dataset.orderId,kind:'customer_attachment',storage_path:path,original_name:file.name,
      mime_type:file.type,file_size:file.size,visible_to_customer:true,uploaded_by:session.user.id
    }).select('id').single();
    if(ins.error){busy(x,false);return toast(ins.error.message,true)}
    const done=await supabase.rpc('complete_order_requirement',{p_order_requirement_id:x.dataset.reqUpload,p_value_text:null,p_document_id:ins.data.id});
    busy(x,false);done.error?toast(done.error.message,true):(toast('تم رفع المستند'),customerDetail(x.dataset.orderId));
  });

  document.querySelectorAll('[data-req-save]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#req-text-'+x.dataset.reqSave);
    const value=input?.value?.trim();
    if(!value)return toast('أدخل المعلومة المطلوبة',true);
    busy(x,true);
    const {error}=await supabase.rpc('complete_order_requirement',{p_order_requirement_id:x.dataset.reqSave,p_value_text:value,p_document_id:null});
    busy(x,false);error?toast(error.message,true):customerDetail(x.closest('.card')?.querySelector('[data-cancel]')?.dataset.cancel || location.hash.split('/').pop());
  });
  document.querySelectorAll('[data-agent-order]').forEach(x=>x.onclick=()=>agentJob(x.dataset.agentOrder));

  document.querySelectorAll('[data-accept]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('accept_order',{p_order_id:x.dataset.accept});
    if(error){busy(x,false);return toast(error.message==='order_unavailable'?'تم أخذ الطلب من وكيل آخر':error.message,true)}
    toast('أصبح الطلب لك');agentJob(x.dataset.accept);
  });

  document.querySelectorAll('[data-status]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('update_order_status',{p_order_id:x.dataset.id,p_status:x.dataset.status,p_note:''});
    if(error){busy(x,false);toast(error.message,true)}else{toast('تم تحديث الحالة');agentJob(x.dataset.id)}
  });

  document.querySelectorAll('[data-upload]').forEach(x=>x.onclick=async()=>{
    const f=document.querySelector('#jobFile')?.files?.[0];
    if(!f)return toast('اختر ملفاً أولاً',true);
    busy(x,true,'جارٍ الرفع...');
    const path=x.dataset.upload+'/'+crypto.randomUUID()+'-'+f.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await supabase.storage.from('order-files').upload(path,f);
    if(up.error){busy(x,false);return toast(up.error.message,true)}
    const {error}=await supabase.from('documents').insert({
      order_id:x.dataset.upload,kind:'final_document',storage_path:path,original_name:f.name,
      mime_type:f.type,file_size:f.size,visible_to_customer:document.querySelector('#visibleToCustomer')?.checked||false,
      uploaded_by:session.user.id
    });
    busy(x,false);error?toast(error.message,true):(toast('تم رفع الملف'),agentJob(x.dataset.upload));
  });

  document.querySelectorAll('[data-download]').forEach(x=>x.onclick=async()=>{
    const {data,error}=await supabase.storage.from('order-files').download(x.dataset.download);
    if(error)return toast(error.message,true);
    const u=URL.createObjectURL(data);window.open(u,'_blank');setTimeout(()=>URL.revokeObjectURL(u),60000);
  });

  document.querySelectorAll('[data-cancel]').forEach(x=>x.onclick=async()=>{
    if(!confirm('إلغاء الطلب؟'))return;
    const {error}=await supabase.rpc('cancel_own_order',{p_order_id:x.dataset.cancel});
    error?toast(error.message,true):(toast('تم إلغاء الطلب'),go('orders'));
  });

  document.querySelectorAll('[data-approve]').forEach(x=>x.onclick=()=>agentStatus(x.dataset.approve,'approved'));
  document.querySelectorAll('[data-suspend]').forEach(x=>x.onclick=()=>agentStatus(x.dataset.suspend,'suspended'));
  document.querySelectorAll('[data-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();const d=new FormData(f),b=f.querySelector('button');busy(b,true);
    const {error}=await supabase.rpc('admin_update_service',{p_service_id:f.dataset.service,p_customer_price:+d.get('cp'),p_agent_payout:+d.get('ap'),p_active:d.get('active')==='on',p_official_fee:+d.get('official_fee')||0});
    busy(b,false);error?toast(error.message,true):toast('تم الحفظ');
  });

  document.querySelectorAll('[data-req-service]').forEach(f=>f.onsubmit=async e=>{
    e.preventDefault();const d=new FormData(f),b=f.querySelector('button');
    const label=(d.get('label')||'').trim();if(!label)return toast('أدخل اسم المتطلب',true);
    busy(b,true);
    const code='req_'+Date.now();
    const {error}=await supabase.rpc('admin_upsert_service_requirement',{
      p_service_id:f.dataset.reqService,p_code:code,p_label_ar:label,p_requirement_type:d.get('type'),p_required:true
    });
    busy(b,false);error?toast(error.message,true):(toast('تمت إضافة المتطلب'),admin());
  });
}
async function agentStatus(id,status){
  const {error}=await supabase.rpc('admin_set_agent_status',{p_agent_id:id,p_status:status});
  error?toast(error.message,true):admin();
}

window.addEventListener('hashchange',render);

try {
  await load();
  render();
} catch (err) {
  console.error(err);
  app.innerHTML='<main><section class="card narrow"><h2>تعذر فتح الصفحة</h2><p>حدّث الصفحة وحاول مرة أخرى.</p></section></main>';
}