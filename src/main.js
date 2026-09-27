import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderRequirements, bindRequirementActions } from './requirements.js';
import { renderServicesAdmin, bindServicesAdmin } from './service-admin.js';

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
const money=v=>'$'+Number(v||0).toFixed(0);
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
  if(profile?.role==='agent') right='';
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
  return shell(`<section class="hero rolehome">
    <small>عنّك</small>
    <h1>كيف بدك تستخدم المنصة؟</h1>
    <div class="rolechoices">
      <button class="rolecard" data-go="new">
        <span class="roleicon">${icon('orders')}</span>
        <span><b>أنا عميل</b><small>بدي أطلب مستندات لعقار</small></span>
      </button>
      <button class="rolecard" data-go="agent">
        <span class="roleicon">${icon('briefcase')}</span>
        <span><b>أنا وكيل</b><small>بدي استلم وأنفّذ طلبات</small></span>
      </button>
    </div>
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
        ${services.map(s=>`<label><input type="radio" name="service" value="${s.code}" required><span><b>${esc(s.name_ar)}</b><em>${money(Number(s.customer_price||0)+Number(s.official_fee||0))}</em></span></label>`).join('')}
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
    ${renderRequirements(reqs||[])}
    ${o.expected_ready_at?`<div class="eta"><small>الوقت المتوقع</small><b>${new Date(o.expected_ready_at).toLocaleDateString('ar-LB')}</b></div>`:''}
    <h3>التتبّع</h3>
    <div class="timeline">${(e||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>
    ${(d||[]).map(x=>`<button class="download full" data-download="${esc(x.storage_path)}">${esc(x.original_name||'فتح المستند')}</button>`).join('')}
    ${o.status==='submitted'?`<button class="danger full" data-cancel="${o.id}">إلغاء الطلب</button>`:''}
  </section>`);
  bind();
  bindRequirementActions({toast,busy,reload:customerDetail});
  liveChannel=supabase.channel('customer-order-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>customerDetail(id))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`id=eq.${id}`},()=>customerDetail(id))
    .subscribe();
}
function agentAuthChoice(){
  app.innerHTML=shell(`<section class="card narrow agentauth">
    <div class="title"><h2>بوابة الوكيل</h2><button data-go="home">رجوع</button></div>
    <button class="primary full" data-go="agent-login">دخول وكيل</button>
    <button class="secondary full" data-go="agent-register">تسجيل وكيل جديد</button>
  </section>`);
  bind();
}

function agentLogin(){
  app.innerHTML=shell(`<section class="card narrow">
    <div class="title"><h2>دخول الوكيل</h2><button data-go="agent">رجوع</button></div>
    <form id="agentLogin">
      <input name="email" type="email" autocomplete="username" required placeholder="البريد الإلكتروني">
      <input name="password" type="password" autocomplete="current-password" required placeholder="كلمة المرور">
      <button class="primary full">دخول</button>
    </form>
  </section>`);
  bind();
}

function agentRegister(){
  app.innerHTML=shell(`<section class="card narrow">
    <div class="title"><h2>تسجيل وكيل جديد</h2><button data-go="agent">رجوع</button></div>
    <form id="agentRegister">
      <input name="name" required placeholder="الاسم">
      <input name="email" type="email" autocomplete="username" required placeholder="البريد الإلكتروني">
      <input name="phone" required placeholder="رقم الهاتف">
      <input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="كلمة المرور">
      <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
      <input name="district" placeholder="القضاء (اختياري)">
      <button class="primary full">إنشاء الحساب</button>
    </form>
  </section>`);
  bind();
}

async function agentPortal(){
  clearLive();
  const {data:a}=await supabase.from('agent_profiles').select('*').eq('user_id',session.user.id).maybeSingle();

  if(!a && session.user?.is_anonymous){
    return agentAuthChoice();
  }

  if(!a){
    app.innerHTML=shell(`<section class="card narrow">
      <div class="title"><h2>إكمال طلب الوكيل</h2><button data-agent-logout>خروج</button></div>
      <form id="agentJoin">
        <input name="name" value="${esc(profile?.full_name)}" required placeholder="الاسم">
        <input name="email" type="email" value="${esc(profile?.email||session.user?.email)}" required placeholder="البريد الإلكتروني">
        <input name="phone" value="${esc(profile?.phone)}" required placeholder="رقم الهاتف">
        <select name="governorate" required><option value="">منطقة العمل</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء (اختياري)">
        <button class="primary full">إرسال طلب الوكيل</button>
      </form>
    </section>`);
    return bind();
  }

  if(a.verification_status!=='approved'){
    const [{data:reqs},{data:docs}]=await Promise.all([
      supabase.from('agent_verification_requirements').select('*').eq('active',true).order('sort_order'),
      supabase.from('agent_documents').select('*').eq('agent_id',session.user.id)
    ]);
    const byReq=Object.fromEntries((docs||[]).map(d=>[d.requirement_id,d]));
    const complete=(reqs||[]).filter(r=>r.required).every(r=>byReq[r.id]?.status==='approved');

    app.innerHTML=shell(`<section class="card narrow pending">
      <div class="title"><h2>طلب الوكيل</h2><button data-agent-logout>خروج</button></div>
      <div class="statusbig">${complete?'جاهز للمراجعة':'أكمل التحقق'}</div>
      <p>${complete?'تم اعتماد مستنداتك. بانتظار تفعيل الحساب.':'ارفع المستندات المطلوبة ليتمكن المسؤول من اعتماد حسابك.'}</p>

      <div class="agentverifylist">
        ${(reqs||[]).map(r=>{
          const d=byReq[r.id];
          const label=d?.status==='approved'?'معتمد':d?.status==='rejected'?'مرفوض':d?.status==='pending'?'قيد المراجعة':'مطلوب';
          return `<div class="verifyitem">
            <div><b>${esc(r.label_ar)}</b><small>${label}${d?.rejection_reason?' • '+esc(d.rejection_reason):''}</small></div>
            ${d?.status==='approved'
              ?'<span class="verifiedmark">✓</span>'
              :`<input type="file" id="agent-doc-${r.id}" accept=".pdf,image/jpeg,image/png,image/webp">
                 <button class="secondary compact" data-agent-doc-upload="${r.id}" data-old-path="${esc(d?.storage_path||'')}">${d?'إعادة الرفع':'رفع'}</button>`}
          </div>`;
        }).join('')}
      </div>
    </section>`);
    return bind();
  }

  await supabase.rpc('refresh_agent_dispatch');
  const [{data:available},{data:mine},{data:completed},{data:coverage},{data:balance},{data:notifications},{data:payouts}]=await Promise.all([
    supabase.rpc('list_available_orders'),
    supabase.from('orders').select('*').eq('assigned_agent_id',session.user.id).not('status','in','("completed","cancelled")').order('accepted_at',{ascending:false}),
    supabase.from('orders').select('*').eq('assigned_agent_id',session.user.id).eq('status','completed').order('completed_at',{ascending:false}).limit(20),
    supabase.from('agent_coverage').select('*').eq('agent_id',session.user.id).eq('active',true),
    supabase.rpc('get_agent_balance'),
    supabase.from('notifications').select('*').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(5),
    supabase.from('payouts').select('*').eq('agent_id',session.user.id).order('created_at',{ascending:false}).limit(10)
  ]);
  const bal=balance?.[0]||{pending:0,available:0};

  app.innerHTML=shell(`<section>
    <div class="agentbar">
      <div class="balancebox">${icon('wallet')}<span><small>الرصيد المتاح</small><strong>${money(bal.available)}</strong></span></div>
      <div class="agentbar-actions">
        <label class="availability"><input id="agentAvailable" type="checkbox" ${a.available?'checked':''}><span>${a.available?'متاح':'غير متاح'}</span></label>
        <button class="ghost" data-agent-logout>خروج</button>
      </div>
    </div>
    <div class="earningsgrid">
      <div><small>قيد التنفيذ</small><b>${money(bal.pending)}</b></div>
      <div><small>متاح</small><b>${money(bal.available)}</b></div>
      <div><small>مدفوع</small><b>${money(bal.paid)}</b></div>
    </div>

    <h3>طلباتي الحالية</h3>
    <div class="stack">${(mine||[]).map(o=>`<button class="row" data-agent-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>${labels[o.status]}</i></button>`).join('')||'<div class="empty">لا يوجد طلبات حالية.</div>'}</div>

    <h3>طلبات متاحة</h3>
    <div class="stack">${(available||[]).map(o=>`<div class="job">
      <span><b>${esc(o.service_names)}</b><small>${esc(o.governorate)}${o.district?' • '+esc(o.district):''} • ${esc(o.cadastral_area)}</small></span>
      <strong>${money(o.agent_payout)}</strong>
      <button class="primary" data-accept="${o.id}">قبول</button>
    </div>`).join('')||'<div class="empty">لا يوجد طلبات متاحة حالياً.</div>'}</div>

    <h3 class="sectionicon">${icon('check')}<span>طلبات مكتملة</span></h3>
    <div class="stack">${(completed||[]).map(o=>`<button class="row" data-agent-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>تم التسليم</i></button>`).join('')||'<div class="empty">لا يوجد طلبات مكتملة بعد.</div>'}</div>

    <h3>الدفعات</h3>
    <div class="stack">${(payouts||[]).map(p=>`<div class="adminrow"><span><b>${money(p.amount)}</b><small>${new Date(p.created_at).toLocaleDateString('ar-LB')}${p.provider_reference?' • '+esc(p.provider_reference):''}</small></span><i>${p.status==='paid'?'مدفوع':p.status==='pending'?'قيد الدفع':'ملغى'}</i></div>`).join('')||'<div class="empty">لا توجد دفعات بعد.</div>'}</div>

    <h3 class="sectionicon">${icon('orders')}<span>آخر الإشعارات</span></h3>
    <div class="stack">${(notifications||[]).map(n=>`<div class="notice ${n.read_at?'':'unread'}"><b>${esc(n.title)}</b><small>${esc(n.body)}</small></div>`).join('')||'<div class="empty">لا يوجد إشعارات.</div>'}</div>

    <details class="coverage">
      <summary>مناطق العمل</summary>
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
      ${o.expected_ready_at?`<div><small>الوقت المتوقع</small><b>${new Date(o.expected_ready_at).toLocaleDateString('ar-LB')}</b></div>`:''}
      ${o.notes?`<div class="wide"><small>ملاحظة</small><b>${esc(o.notes)}</b></div>`:''}
    </div>

    <h3>التتبّع</h3>
    <div class="timeline">${(events||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>

    <div class="uploadbox">
      <input id="jobFile" type="file" accept=".pdf,image/*">
      <label class="check"><input id="visibleToCustomer" type="checkbox"> يظهر للعميل</label>
      <button class="secondary full" data-upload="${o.id}">رفع ملف</button>
      ${(docs||[]).length?`<small>${docs.length} ملف مرفوع</small>`:''}
    </div>

    ${next?`<button class="primary full next-action" data-status="${next[0]}" data-id="${o.id}">${next[1]}</button>`:'<div class="donebox">تم إكمال الطلب</div>'}
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-job-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>agentJob(id))
    .subscribe();
}
async function staffAccess(){
  clearLive();
  if(profile?.role==='admin'){
    go('admin');
    return;
  }

  app.innerHTML=shell(`<section class="card narrow stafflogin">
    <div class="title"><h2>دخول الإدارة</h2><button data-go="home">رجوع</button></div>
    <form id="staffLogin">
      <input name="email" type="email" autocomplete="email" required placeholder="البريد الإلكتروني">
      <button class="primary full">إرسال رابط الدخول</button>
    </form>
    <small class="staffhint">الدخول متاح فقط للحساب الإداري المعتمد.</small>
  </section>`);
  bind();
}

async function admin(){
  clearLive();
  if(profile?.role!=='admin')return go('home');
  const [{data:a},{data:s},{data:o},{data:reqs}]=await Promise.all([
    supabase.from('agent_profiles').select('*').order('created_at',{ascending:false}),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(50),
    supabase.from('service_requirements').select('*').order('sort_order')
  ]);
  const ids=(a||[]).map(x=>x.user_id),names={};
  if(ids.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',ids);
    (p||[]).forEach(x=>names[x.id]=x);
  }
  app.innerHTML=shell(`<section>
    <div class="title"><h2>الإدارة</h2><button data-go="home">رجوع</button></div>
    <h3>الوكلاء</h3>
    <div class="stack">${(a||[]).map(x=>`<button class="row" data-admin-agent="${x.user_id}">
      <span><b>${esc(names[x.user_id]?.full_name||names[x.user_id]?.email||x.user_id)}</b><small>${esc(names[x.user_id]?.phone||'')} • ${x.verification_status}</small></span>
      <i>فتح</i>
    </button>`).join('')||'<div class="empty">لا يوجد.</div>'}</div>
    <h3>الخدمات والتسعير</h3>
    <div class="stack">${renderServicesAdmin(s||[],reqs||[])}</div>
    <h3>الدفعات</h3>
    <div class="payoutadmin">
      <div class="payoutcreate">
        <span><small>المتاح للدفع</small><b>${money(available)}</b></span>
        <button class="primary" data-create-payout="${id}" ${available>0?'':'disabled'}>إنشاء دفعة</button>
      </div>
      <div class="stack">${(payouts||[]).map(p=>`<div class="adminrow">
        <span><b>${money(p.amount)}</b><small>${new Date(p.created_at).toLocaleDateString('ar-LB')}${p.provider_reference?' • '+esc(p.provider_reference):''}</small></span>
        <div class="verifyactions">
          <i>${p.status==='paid'?'مدفوع':p.status==='pending'?'قيد الدفع':'ملغى'}</i>
          ${p.status==='pending'?`<button class="primary compact" data-pay-payout="${p.id}" data-agent-id="${id}">تم الدفع</button><button class="secondary compact" data-cancel-payout="${p.id}" data-agent-id="${id}">إلغاء</button>`:''}
        </div>
      </div>`).join('')||'<div class="empty">لا توجد دفعات بعد.</div>'}</div>
    </div>

    <h3>آخر الطلبات</h3>
    <div class="stack">${(o||[]).map(x=>`<button class="row" data-admin-order="${x.id}"><span><b>${x.public_code}</b><small>${esc(x.cadastral_area)} • ${esc(x.property_number)}</small></span><i>${labels[x.status]}</i></button>`).join('')}</div>
  </section>`);
  bind();
}
async function adminAgent(id){
  clearLive();
  if(profile?.role!=='admin')return go('home');

  const [{data:a,error},{data:p},{data:coverage},{data:orders},{data:ledger},{data:reqs},{data:docs},{data:payouts}]=await Promise.all([
    supabase.from('agent_profiles').select('*').eq('user_id',id).single(),
    supabase.from('profiles').select('id,full_name,email,phone,is_active').eq('id',id).single(),
    supabase.from('agent_coverage').select('*').eq('agent_id',id).eq('active',true),
    supabase.from('orders').select('*').eq('assigned_agent_id',id).order('created_at',{ascending:false}).limit(30),
    supabase.from('agent_ledger').select('*').eq('agent_id',id).order('created_at',{ascending:false}).limit(100),
    supabase.from('agent_verification_requirements').select('*').eq('active',true).order('sort_order'),
    supabase.from('agent_documents').select('*').eq('agent_id',id),
    supabase.from('payouts').select('*').eq('agent_id',id).order('created_at',{ascending:false}).limit(20)
  ]);

  if(error||!a)return toast(error?.message||'تعذر فتح الوكيل',true);

  const pending=(ledger||[]).filter(x=>x.status==='pending'&&x.entry_type!=='payout').reduce((s,x)=>s+Number(x.amount||0),0);
  const available=(ledger||[]).filter(x=>x.status==='available'&&x.entry_type!=='payout'&&!x.payout_id).reduce((s,x)=>s+Number(x.amount||0),0);
  const paid=(ledger||[]).filter(x=>x.status==='paid'&&x.entry_type!=='payout').reduce((s,x)=>s+Number(x.amount||0),0);
  const docsByReq=Object.fromEntries((docs||[]).map(d=>[d.requirement_id,d]));
  const docsApproved=(reqs||[]).filter(r=>r.required).every(r=>docsByReq[r.id]?.status==='approved');

  app.innerHTML=shell(`<section>
    <div class="title"><h2>${esc(p?.full_name||'وكيل')}</h2><button data-go="admin">رجوع</button></div>

    <div class="card agentprofilecard">
      <div class="jobinfo">
        <div><small>البريد</small><b>${esc(p?.email||'—')}</b></div>
        <div><small>الهاتف</small><b>${esc(p?.phone||'—')}</b></div>
        <div><small>الحالة</small><b>${esc(a.verification_status)}</b></div>
        <div><small>الطلبات المكتملة</small><b>${a.completed_orders||0}</b></div>
      </div>

      <div class="adminagentactions">
        ${a.verification_status==='approved'
          ?`<button class="secondary" data-suspend="${id}">تعليق الوكيل</button>`
          :`<button class="primary" data-approve="${id}" ${docsApproved?'':'disabled'}>اعتماد الوكيل</button>`}
      </div>
    </div>

    <h3>التحقق</h3>
    <div class="stack">
      ${(reqs||[]).map(r=>{
        const d=docsByReq[r.id];
        if(!d)return `<div class="adminrow"><span><b>${esc(r.label_ar)}</b><small>لم يتم الرفع</small></span><i>ناقص</i></div>`;
        return `<div class="adminrow verifyadmin">
          <span><b>${esc(r.label_ar)}</b><small>${d.status==='approved'?'معتمد':d.status==='rejected'?'مرفوض':'قيد المراجعة'}${d.rejection_reason?' • '+esc(d.rejection_reason):''}</small></span>
          <div class="verifyactions">
            <button class="secondary compact" data-agent-doc-view="${d.storage_path}">فتح</button>
            ${d.status!=='approved'?`<button class="primary compact" data-agent-doc-review="${d.id}" data-review-status="approved" data-agent-id="${id}">اعتماد</button>`:''}
            ${d.status!=='rejected'?`<button class="secondary compact" data-agent-doc-review="${d.id}" data-review-status="rejected" data-agent-id="${id}">رفض</button>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>

    <h3>مناطق العمل</h3>
    <div class="stack">${(coverage||[]).map(x=>`<div class="adminrow"><span><b>${esc(x.governorate)}</b><small>${esc(x.district||'كل المحافظة')}</small></span></div>`).join('')||'<div class="empty">لا توجد مناطق.</div>'}</div>

    <h3>الأرباح</h3>
    <div class="earningsgrid">
      <div><small>قيد التنفيذ</small><b>${money(pending)}</b></div>
      <div><small>متاح</small><b>${money(available)}</b></div>
      <div><small>مدفوع</small><b>${money(paid)}</b></div>
    </div>

    <h3>آخر الطلبات</h3>
    <div class="stack">${(orders||[]).map(o=>`<button class="row" data-admin-order="${o.id}">
      <span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span>
      <i>${labels[o.status]||o.status}</i>
    </button>`).join('')||'<div class="empty">لا توجد طلبات.</div>'}</div>
  </section>`);
  bind();
}

async function adminOrder(id){
  clearLive();
  if(profile?.role!=='admin')return go('home');
  const [{data:pack,error},{data:agents}]=await Promise.all([
    supabase.rpc('admin_get_order',{p_order_id:id}),
    supabase.from('agent_profiles').select('user_id,verification_status').eq('verification_status','approved')
  ]);
  if(error||!pack)return toast(error?.message||'تعذر فتح الطلب',true);

  const agentIds=(agents||[]).map(x=>x.user_id),agentNames={};
  if(agentIds.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',agentIds);
    (p||[]).forEach(x=>agentNames[x.id]=x);
  }
  const o=pack.order,items=pack.items||[],events=pack.events||[],docs=pack.documents||[],reqs=pack.requirements||[];
  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>${esc(o.public_code)}</h2><button data-go="admin">رجوع</button></div>
    <div class="jobinfo">
      <div><small>العميل</small><b>${esc(o.customer_name||'—')}</b></div>
      <div><small>الهاتف</small><b>${esc(o.customer_phone||'—')}</b></div>
      <div><small>العقار</small><b>${esc(o.cadastral_area)} • ${esc(o.property_number)}</b></div>
      <div><small>الخدمة</small><b>${items.map(x=>esc(x.service_name_ar)).join('، ')}</b></div>
      <div><small>الإجمالي</small><b>${money(o.total_amount)}</b></div>
      <div><small>الحالة</small><b>${labels[o.status]||o.status}</b></div>
    </div>

    <h3>إدارة الطلب</h3>
    <form id="adminStatusForm">
      <select name="status">
        ${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${o.status===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <input name="note" placeholder="ملاحظة للإدارة (اختياري)">
      <button class="secondary full">حفظ الحالة</button>
    </form>

    <form id="adminAssignForm">
      <select name="agent" required>
        <option value="">تعيين / إعادة تعيين وكيل</option>
        ${(agents||[]).map(a=>`<option value="${a.user_id}" ${o.assigned_agent_id===a.user_id?'selected':''}>${esc(agentNames[a.user_id]?.full_name||agentNames[a.user_id]?.email||a.user_id)}</option>`).join('')}
      </select>
      <button class="secondary full">تعيين الوكيل</button>
    </form>

    <button class="danger full" data-admin-cancel="${o.id}">إلغاء الطلب</button>

    <h3>المتطلبات</h3>
    <div class="stack">${reqs.length?reqs.map(r=>`<div class="adminrow"><span><b>${esc(r.label_ar)}</b><small>${r.required?'مطلوب':'اختياري'}</small></span><i>${r.completed_at?'مكتمل':'ناقص'}</i></div>`).join(''):'<div class="empty">لا توجد متطلبات.</div>'}</div>

    <h3>الملفات</h3>
    <div class="stack">${docs.length?docs.map(d=>`<div class="adminrow"><span><b>${esc(d.original_name||'ملف')}</b><small>${esc(d.kind)}</small></span></div>`).join(''):'<div class="empty">لا توجد ملفات.</div>'}</div>

    <h3>التتبّع</h3>
    <div class="timeline">${events.map(e=>`<div><b>${esc(e.label_ar)}</b><small>${new Date(e.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>
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
  else if(r==='agent-login'){app.innerHTML='';return agentLogin();}
  else if(r==='agent-register'){app.innerHTML='';return agentRegister();}
  else if(r==='staff')return staffAccess();
  else if(r==='admin')return admin();
  else if(r.startsWith('admin-agent/'))return adminAgent(r.split('/')[1]);
  else if(r.startsWith('admin-order/'))return adminOrder(r.split('/')[1]);
  else if(profile?.role==='agent')return agentPortal();
  else app.innerHTML=home();
  bind();
}
function bind(){
  document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>go(x.dataset.go));

  const agentLoginForm=document.querySelector('#agentLogin');
  if(agentLoginForm)agentLoginForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(agentLoginForm),b=agentLoginForm.querySelector('button');
    busy(b,true,'جارٍ الدخول...');
    await supabase.auth.signOut();
    const {data,error}=await supabase.auth.signInWithPassword({
      email:String(f.get('email')||'').trim(),
      password:String(f.get('password')||'')
    });
    if(error){busy(b,false);return toast('البريد أو كلمة المرور غير صحيحة.',true)}
    session=data.session;
    await load();
    toast('تم تسجيل الدخول');
    agentPortal();
  };

  const agentRegisterForm=document.querySelector('#agentRegister');
  if(agentRegisterForm)agentRegisterForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(agentRegisterForm),b=agentRegisterForm.querySelector('button');
    const email=String(f.get('email')||'').trim();
    const password=String(f.get('password')||'');
    busy(b,true,'جارٍ إنشاء الحساب...');
    await supabase.auth.signOut();

    const {data,error}=await supabase.auth.signUp({
      email,
      password,
      options:{data:{full_name:String(f.get('name')||''),phone:String(f.get('phone')||'')}}
    });
    if(error){busy(b,false);return toast(error.message,true)}

    if(!data.session){
      busy(b,false);
      app.innerHTML=shell('<section class="card narrow pending"><h2>تم إنشاء الحساب</h2><p>افتح بريدك لتأكيد الحساب، ثم ارجع إلى دخول الوكيل.</p><button class="primary full" data-go="agent-login">دخول الوكيل</button></section>');
      return bind();
    }

    session=data.session;
    await load();
    const contact=await supabase.rpc('update_my_profile',{
      p_full_name:f.get('name'),
      p_phone:f.get('phone'),
      p_locale:'ar',
      p_email:email
    });
    if(contact.error){busy(b,false);return toast(contact.error.message,true)}
    profile=contact.data;
    const applied=await supabase.rpc('apply_as_agent');
    if(applied.error){busy(b,false);return toast(applied.error.message,true)}
    const coverage=await supabase.rpc('replace_agent_coverage',{
      p_governorate:f.get('governorate'),
      p_district:f.get('district')||''
    });
    busy(b,false);
    if(coverage.error)return toast(coverage.error.message,true);
    await load();
    toast('تم إرسال طلب الوكيل');
    agentPortal();
  };

  document.querySelectorAll('[data-agent-logout]').forEach(x=>x.onclick=async()=>{
    await supabase.auth.signOut();
    session=null;profile=null;
    await load();
    go('home');
  });

  const staffLogin=document.querySelector('#staffLogin');
  if(staffLogin)staffLogin.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(staffLogin),email=String(fd.get('email')||'').trim().toLowerCase();
    const b=staffLogin.querySelector('button');
    if(email!=='bachir.ban@gmail.com')return toast('هذا البريد غير مخوّل للإدارة.',true);
    busy(b,true,'جارٍ الإرسال...');
    await supabase.auth.signOut();
    const redirect=new URL('./#staff',location.href).href;
    const {error}=await supabase.auth.signInWithOtp({
      email,
      options:{emailRedirectTo:redirect,shouldCreateUser:true}
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    staffLogin.innerHTML='<div class="loginSent"><b>تم إرسال رابط الدخول.</b><small>افتح بريدك واضغط الرابط للمتابعة.</small></div>';
  };

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
    else{toast('تم إنشاء الطلب');customerDetail(data?.[0]?.order_id)}
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

  document.querySelectorAll('[data-agent-doc-upload]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#agent-doc-'+x.dataset.agentDocUpload);
    const file=input?.files?.[0];
    if(!file)return toast('اختر الملف أولاً',true);
    if(file.size>10*1024*1024)return toast('الحد الأقصى للملف 10MB',true);
    if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))return toast('نوع الملف غير مدعوم',true);

    busy(x,true,'جارٍ الرفع...');
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path=session.user.id+'/'+x.dataset.agentDocUpload+'/'+Date.now()+'-'+safe;
    const up=await supabase.storage.from('agent-files').upload(path,file);
    if(up.error){busy(x,false);return toast(up.error.message,true)}

    const saved=await supabase.rpc('submit_agent_document',{
      p_requirement_id:x.dataset.agentDocUpload,
      p_storage_path:path,
      p_original_name:file.name,
      p_mime_type:file.type,
      p_file_size:file.size
    });

    if(saved.error){
      await supabase.storage.from('agent-files').remove([path]);
      busy(x,false);
      return toast(saved.error.message,true);
    }

    const old=x.dataset.oldPath;
    if(old && old!==path)await supabase.storage.from('agent-files').remove([old]);
    busy(x,false);
    toast('تم رفع المستند');
    agentPortal();
  });

  document.querySelectorAll('[data-agent-doc-view]').forEach(x=>x.onclick=async()=>{
    const {data,error}=await supabase.storage.from('agent-files').download(x.dataset.agentDocView);
    if(error)return toast(error.message,true);
    const u=URL.createObjectURL(data);
    window.open(u,'_blank');
    setTimeout(()=>URL.revokeObjectURL(u),60000);
  });

  document.querySelectorAll('[data-create-payout]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('create_payout_batch',{p_agent_id:x.dataset.createPayout,p_currency:'USD'});
    busy(x,false);
    error?toast(error.message==='no_available_balance'?'لا يوجد رصيد متاح للدفع':error.message,true):(toast('تم إنشاء الدفعة'),adminAgent(x.dataset.createPayout));
  });

  document.querySelectorAll('[data-pay-payout]').forEach(x=>x.onclick=async()=>{
    const reference=prompt('مرجع التحويل (اختياري)')||'';
    busy(x,true);
    const {error}=await supabase.rpc('admin_mark_payout_paid',{p_payout_id:x.dataset.payPayout,p_provider:'manual',p_reference:reference});
    busy(x,false);
    error?toast(error.message,true):(toast('تم تسجيل الدفعة كمدفوعة'),adminAgent(x.dataset.agentId));
  });

  document.querySelectorAll('[data-cancel-payout]').forEach(x=>x.onclick=async()=>{
    if(!confirm('إلغاء هذه الدفعة؟'))return;
    busy(x,true);
    const {error}=await supabase.rpc('admin_cancel_payout',{p_payout_id:x.dataset.cancelPayout});
    busy(x,false);
    error?toast(error.message,true):(toast('تم إلغاء الدفعة'),adminAgent(x.dataset.agentId));
  });

  document.querySelectorAll('[data-agent-doc-review]').forEach(x=>x.onclick=async()=>{
    let reason='';
    if(x.dataset.reviewStatus==='rejected'){
      reason=prompt('سبب الرفض (اختياري)')||'';
    }
    busy(x,true);
    const {error}=await supabase.rpc('admin_review_agent_document',{
      p_document_id:x.dataset.agentDocReview,
      p_status:x.dataset.reviewStatus,
      p_reason:reason
    });
    busy(x,false);
    error?toast(error.message,true):adminAgent(x.dataset.agentId);
  });

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
  document.querySelectorAll('[data-admin-order]').forEach(x=>x.onclick=()=>go('admin-order/'+x.dataset.adminOrder));
  document.querySelectorAll('[data-admin-agent]').forEach(x=>x.onclick=()=>go('admin-agent/'+x.dataset.adminAgent));
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
  const adminStatus=document.querySelector('#adminStatusForm');
  if(adminStatus)adminStatus.onsubmit=async e=>{
    e.preventDefault();const d=new FormData(adminStatus),b=adminStatus.querySelector('button');busy(b,true);
    const id=location.hash.split('/')[1];
    const {error}=await supabase.rpc('admin_update_order',{p_order_id:id,p_status:d.get('status'),p_official_fees:null,p_total_amount:null,p_note:d.get('note')||''});
    busy(b,false);error?toast(error.message,true):(toast('تم تحديث الطلب'),adminOrder(id));
  };

  const adminAssign=document.querySelector('#adminAssignForm');
  if(adminAssign)adminAssign.onsubmit=async e=>{
    e.preventDefault();const d=new FormData(adminAssign),b=adminAssign.querySelector('button');busy(b,true);
    const id=location.hash.split('/')[1];
    const {error}=await supabase.rpc('admin_reassign_order',{p_order_id:id,p_agent_id:d.get('agent'),p_reason:''});
    busy(b,false);error?toast(error.message,true):(toast('تم تعيين الوكيل'),adminOrder(id));
  };

  document.querySelectorAll('[data-admin-cancel]').forEach(x=>x.onclick=async()=>{
    if(!confirm('إلغاء هذا الطلب؟'))return;
    const {error}=await supabase.rpc('admin_cancel_order',{p_order_id:x.dataset.adminCancel,p_reason:''});
    error?toast(error.message,true):(toast('تم إلغاء الطلب'),admin());
  });

  bindServicesAdmin({toast,busy,reload:admin});
}
async function agentStatus(id,status){
  const {error}=await supabase.rpc('admin_set_agent_status',{p_agent_id:id,p_status:status});
  if(error)return toast(error.message,true);
  const r=location.hash.slice(1);
  if(r.startsWith('admin-agent/'))adminAgent(id);
  else admin();
}

window.addEventListener('hashchange',render);

try {
  await load();
  render();
} catch (err) {
  console.error(err);
  app.innerHTML='<main><section class="card narrow"><h2>تعذر فتح الصفحة</h2><p>حدّث الصفحة وحاول مرة أخرى.</p></section></main>';
}
