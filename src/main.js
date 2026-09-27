import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderRequirements, bindRequirementActions } from './requirements.js';
import { renderServicesAdmin, bindServicesAdmin } from './service-admin.js';
import { renderNewOrder, bindServiceSelection } from './order-form.js';

const app=document.querySelector('#app');
let session=null,profile=null,services=[],bundleItems=[],serviceRequirements=[],paymentsEnabled=false,liveChannel=null;

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
const isAnonymousUser=()=>{
  const u=session?.user;
  return u?.is_anonymous===true
    || u?.app_metadata?.provider==='anonymous'
    || (!u?.email&&!u?.phone&&(!u?.identities||u.identities.length===0));
};

function shell(body){
  let right='';
  const anonymous=isAnonymousUser();
  if(profile?.role==='admin') right=`<button class="toplink withicon" data-go="admin">${icon('settings')}<span>الإدارة</span></button>`;
  else if(!anonymous&&['customer','agent'].includes(profile?.role)) right=`<button class="toplink withicon" data-go="account">${icon('orders')}<span>حسابي</span></button>`;
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
  const [{data:p},{data:srv},{data:bundles},{data:reqCatalog},{data:paymentSetting}]=await Promise.all([
    supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle(),
    supabase.from('services').select('*').eq('active',true).order('sort_order'),
    supabase.from('service_bundle_items').select('*').order('sort_order'),
    supabase.from('service_requirements').select('*').eq('active',true).order('sort_order'),
    supabase.from('app_settings').select('value').eq('key','payments_enforced').maybeSingle()
  ]);
  profile=p;services=srv||[];bundleItems=bundles||[];serviceRequirements=reqCatalog||[];
  paymentsEnabled=paymentSetting?.value?.enabled===true;
}
function home(){
  return shell(`<section class="hero rolehome">
    <small>عنّك</small>
    <h1>كيف بدك تستخدم المنصة؟</h1>
    <div class="rolechoices">
      <button class="rolecard" data-go="customer">
        <span class="roleicon">${icon('orders')}</span>
        <span><b>أنا عميل</b><small>بدي أطلب وأتابع مستندات عقاري</small></span>
      </button>
      <button class="rolecard" data-go="agent">
        <span class="roleicon">${icon('briefcase')}</span>
        <span><b>أنا وكيل</b><small>بدي استلم وأنفّذ طلبات</small></span>
      </button>
    </div>
  </section>`);
}
function customerAuthChoice(){
  app.innerHTML=shell(`<section class="card narrow agentauth">
    <div class="title"><h2>حساب العميل</h2><button data-go="home">رجوع</button></div>
    <button class="primary full" data-go="customer-login">دخول</button>
    <button class="secondary full" data-go="customer-register">إنشاء حساب</button>
  </section>`);
  bind();
}

function customerLogin(){
  app.innerHTML=shell(`<section class="card narrow">
    <div class="title"><h2>دخول العميل</h2><button data-go="customer">رجوع</button></div>
    <form id="customerLogin">
      <input name="email" type="email" autocomplete="username" required placeholder="البريد الإلكتروني">
      <input name="password" type="password" autocomplete="current-password" required placeholder="كلمة المرور">
      <button class="primary full">دخول</button>
    </form>
    <button class="ghost full" data-go="forgot-password">نسيت كلمة المرور؟</button>
  </section>`);
  bind();
}

function customerRegister(){
  app.innerHTML=shell(`<section class="card narrow">
    <div class="title"><h2>إنشاء حساب عميل</h2><button data-go="customer">رجوع</button></div>
    <form id="customerRegister">
      <input name="name" required placeholder="الاسم">
      <input name="email" type="email" autocomplete="username" required placeholder="البريد الإلكتروني">
      <input name="phone" required placeholder="رقم الهاتف">
      <input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="كلمة المرور">
      <button class="primary full">إنشاء الحساب</button>
    </form>
  </section>`);
  bind();
}

async function customerPortal(){
  clearLive();
  if(isAnonymousUser())return customerAuthChoice();
  if(profile?.role==='agent')return agentPortal();
  if(profile?.role==='admin')return go('admin');

  const [{data:allOrders,error},{data:notifications}]=await Promise.all([
    supabase.from('orders').select('*').eq('customer_id',session.user.id).order('created_at',{ascending:false}),
    supabase.from('notifications').select('*').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(5)
  ]);
  if(error)return toast(error.message,true);

  const rows=allOrders||[];
  const current=rows.filter(o=>!['completed','cancelled'].includes(o.status));
  const completed=rows.filter(o=>o.status==='completed');
  const recent=rows.slice(0,5);

  app.innerHTML=shell(`<section class="customerdashboard">
    <div class="customerbar">
      <div>
        <small>مرحباً</small>
        <h2>${esc(profile?.full_name||session?.user?.email||'')}</h2>
      </div>
      <button class="ghost" data-customer-logout>تسجيل الخروج</button>
    </div>

    <div class="customermetrics">
      <div><small>طلبات جارية</small><b>${current.length}</b></div>
      <div><small>طلبات مكتملة</small><b>${completed.length}</b></div>
      <div><small>كل الطلبات</small><b>${rows.length}</b></div>
    </div>

    <div class="customerquick">
      <button class="primary" data-go="new">${icon('orders')}<span>طلب جديد</span></button>
      <button class="secondary" data-go="orders">${icon('check')}<span>كل طلباتي</span></button>
    </div>

    <h3>الطلبات الجارية</h3>
    <div class="stack">
      ${current.slice(0,5).map(o=>`<button class="row" data-order="${o.id}">
        <span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span>
        <i>${labels[o.status]||o.status}</i>
      </button>`).join('')||'<div class="empty">لا يوجد طلبات جارية.</div>'}
    </div>

    <h3>آخر الطلبات</h3>
    <div class="stack">
      ${recent.map(o=>`<button class="row" data-order="${o.id}">
        <span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span>
        <i>${labels[o.status]||o.status}</i>
      </button>`).join('')||'<div class="empty">لم تنشئ أي طلب بعد.</div>'}
    </div>

    <h3 class="sectionicon">${icon('orders')}<span>آخر الإشعارات</span></h3>
    <div class="stack">
      ${(notifications||[]).map(n=>`<div class="notice ${n.read_at?'':'unread'}"><b>${esc(n.title)}</b><small>${esc(n.body)}</small></div>`).join('')||'<div class="empty">لا يوجد إشعارات.</div>'}
    </div>
  </section>`);
  bind();

  liveChannel=supabase.channel('customer-feed-'+session.user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`customer_id=eq.${session.user.id}`},()=>customerPortal())
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${session.user.id}`},()=>customerPortal())
    .subscribe();
}

async function accountPage(){
  clearLive();
  if(isAnonymousUser())return go('home');

  const isAgent=profile?.role==='agent';
  const agent=isAgent
    ?(await supabase.from('agent_profiles').select('verification_status,completed_orders,rating,available').eq('user_id',session.user.id).maybeSingle()).data
    :null;
  const coverage=isAgent
    ?(await supabase.from('agent_coverage').select('governorate,district').eq('agent_id',session.user.id).eq('active',true)).data||[]
    :[];

  const roleLabel=isAgent?'وكيل':profile?.role==='customer'?'عميل':'إدارة';
  app.innerHTML=shell(`<section class="accountpage">
    <div class="title">
      <div><h2>حسابي</h2><small>${roleLabel}</small></div>
      <button data-go="home">رجوع</button>
    </div>

    <section class="card">
      <h3>معلومات الحساب</h3>
      <form id="accountProfileForm">
        <label>الاسم<input name="name" required value="${esc(profile?.full_name||'')}"></label>
        <label>رقم الهاتف<input name="phone" value="${esc(profile?.phone||'')}"></label>
        <label>البريد الإلكتروني<input value="${esc(session?.user?.email||profile?.email||'')}" disabled></label>
        <button class="primary full">حفظ المعلومات</button>
      </form>
    </section>

    ${isAgent?`<section class="card">
      <h3>حساب الوكيل</h3>
      <div class="accountfacts">
        <div><small>حالة الحساب</small><b>${agent?.verification_status==='approved'?'معتمد':agent?.verification_status==='pending'?'قيد المراجعة':agent?.verification_status==='suspended'?'موقوف':'غير معتمد'}</b></div>
        <div><small>طلبات مكتملة</small><b>${agent?.completed_orders||0}</b></div>
        <div><small>مناطق العمل</small><b>${coverage.length||0}</b></div>
      </div>
      <small class="accountmuted">${coverage.map(x=>esc(x.governorate)+(x.district?' / '+esc(x.district):'')).join('، ')||'لا توجد مناطق عمل.'}</small>
    </section>`:''}

    <section class="card">
      <h3>تغيير كلمة المرور</h3>
      <form id="accountPasswordForm">
        <input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="كلمة المرور الجديدة">
        <input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="تأكيد كلمة المرور">
        <button class="secondary full">تغيير كلمة المرور</button>
      </form>
    </section>

    <button class="secondary full account-signout" data-account-logout>تسجيل الخروج</button>
  </section>`);
  bind();
}

function forgotPasswordPage(){
  if(!isAnonymousUser())return go('account');
  app.innerHTML=shell(`<section class="card narrow">
    <div class="title"><h2>استعادة كلمة المرور</h2><button data-go="home">رجوع</button></div>
    <form id="forgotPasswordForm">
      <input name="email" type="email" autocomplete="email" required placeholder="البريد الإلكتروني">
      <button class="primary full">إرسال رابط الاستعادة</button>
    </form>
  </section>`);
  bind();
}

function resetPasswordPage(){
  app.innerHTML=shell(`<section class="card narrow">
    <h2>كلمة مرور جديدة</h2>
    <form id="resetPasswordForm">
      <input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="كلمة المرور الجديدة">
      <input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="تأكيد كلمة المرور">
      <button class="primary full">حفظ كلمة المرور</button>
    </form>
  </section>`);
  bind();
}

function newOrder(){
  if(isAnonymousUser())return customerAuthChoice();
  if(profile?.role!=='customer')return profile?.role==='agent'?agentPortal():go('admin');
  return shell(renderNewOrder({services,bundleItems,serviceRequirements,profile,gov,esc,money}));
}
async function orders(){
  clearLive();
  const {data,error}=await supabase.from('orders').select('*').eq('customer_id',session.user.id).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  app.innerHTML=shell(`<section>
    <div class="title"><h2>طلباتي</h2><button data-go="customer">رجوع</button></div>
    <div class="stack">${(data||[]).map(o=>`<button class="row" data-order="${o.id}"><span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>${labels[o.status]||o.status}</i></button>`).join('')||'<div class="empty">لا يوجد طلبات.</div>'}</div>
    <button class="primary full" data-go="new">طلب جديد</button>
  </section>`);
  bind();
}
async function customerDetail(id){
  clearLive();
  const [{data:o,error},{data:e},{data:d},{data:i},{data:reqs},{data:feedback},{data:deliverables},{data:payments}]=await Promise.all([
    supabase.from('orders').select('*').eq('id',id).single(),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).eq('visible_to_customer',true).order('created_at'),
    supabase.from('order_items').select('*').eq('order_id',id),
    supabase.from('order_requirements').select('*').eq('order_id',id).order('created_at'),
    supabase.rpc('get_order_feedback',{p_order_id:id}),
    supabase.from('order_deliverables').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('payments').select('*').eq('order_id',id).order('created_at',{ascending:false}).limit(1)
  ]);
  if(error)return toast(error.message,true);
  const incompleteRequired=(reqs||[]).filter(r=>r.required&&!r.completed_at);
  const payment=payments?.[0];
  const paymentLabel=o.refund_pending?'رد المبلغ قيد المعالجة':
    payment?.status==='paid'?'مدفوع':
    payment?.status==='refunded'?'تم رد المبلغ':
    payment?.status==='failed'?'فشل الدفع':'بانتظار الدفع';
  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>${o.public_code}</h2><button data-go="orders">رجوع</button></div>
    <div class="summary">
      <b>${esc(o.cadastral_area)} • عقار ${esc(o.property_number)}</b>
      <span>${(i||[]).map(x=>esc(x.service_name_ar)).join('، ')}</span>
      <strong>${money(o.total_amount)}</strong>
    </div>
    ${(paymentsEnabled||o.refund_pending||['paid','refunded','partially_refunded'].includes(payment?.status))?`<div class="paymentbox">
      <div><small>الدفع</small><b>${paymentLabel}</b></div>
      <strong>${money(payment?.amount??o.total_amount)}</strong>
    </div>`:''}
    ${o.status==='completed'?`<div class="completebox"><span class="completecheck">✓</span><div><b>اكتمل الطلب</b><small>مستنداتك جاهزة أدناه.</small></div></div>`:''}
    ${incompleteRequired.length?`<div class="completebox requirementgate"><span class="completecheck">!</span><div><b>أكمل المعلومات المطلوبة</b><small>لن يظهر الطلب للوكلاء قبل إكمال ${incompleteRequired.length} عنصر مطلوب.</small></div></div>`:''}
    ${(deliverables||[]).length?`<div class="deliverables"><small>المستندات المطلوبة</small><div>${deliverables.map(x=>`<span>${esc(x.service_name_ar)}</span>`).join('')}</div></div>`:''}
    ${renderRequirements(reqs||[])}
    ${o.expected_ready_at&&o.status!=='completed'?`<div class="eta"><small>الوقت المتوقع</small><b>${new Date(o.expected_ready_at).toLocaleDateString('ar-LB')}</b></div>`:''}

    ${o.status==='completed'?`
      <h3>المستندات</h3>
      <div class="stack">
        ${(d||[]).filter(x=>x.kind==='final_document').map(x=>`<button class="download full" data-download="${esc(x.storage_path)}">${esc(x.original_name||'فتح المستند')}</button>`).join('')||'<div class="empty">لا يوجد مستند نهائي مرفوع بعد.</div>'}
      </div>

      <h3>التقييم</h3>
      ${feedback?.rating
        ?`<div class="feedbackdone"><b>${'★'.repeat(Number(feedback.rating.rating||0))}</b><small>${esc(feedback.rating.comment||'تم إرسال تقييمك.')}</small></div>`
        :`<form id="ratingForm" data-order-id="${o.id}" class="feedbackform">
            <select name="rating" required>
              <option value="">اختر التقييم</option>
              <option value="5">★★★★★</option>
              <option value="4">★★★★</option>
              <option value="3">★★★</option>
              <option value="2">★★</option>
              <option value="1">★</option>
            </select>
            <textarea name="comment" placeholder="ملاحظة (اختياري)"></textarea>
            <button class="secondary full">إرسال التقييم</button>
          </form>`}

      <h3>الدعم</h3>
      ${feedback?.dispute && ['open','reviewing'].includes(feedback.dispute.status)
        ?`<div class="feedbackdone"><b>${feedback.dispute.status==='reviewing'?'طلب الدعم قيد المراجعة':'طلب الدعم مفتوح'}</b><small>${esc(feedback.dispute.reason)}</small></div>`
        :`${feedback?.dispute?.resolution?`<div class="feedbackdone"><b>رد الإدارة</b><small>${esc(feedback.dispute.resolution)}</small></div>`:''}
          <form id="supportForm" data-order-id="${o.id}" class="feedbackform">
            <textarea name="reason" required minlength="3" placeholder="اشرح المشكلة باختصار"></textarea>
            <button class="secondary full">طلب دعم جديد</button>
          </form>`}
    `:''}

    <h3>التتبّع</h3>
    <div class="timeline">${(e||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>
    ${o.status!=='completed'?(d||[]).filter(x=>x.kind==='final_document').map(x=>`<button class="download full" data-download="${esc(x.storage_path)}">${esc(x.original_name||'فتح المستند')}</button>`).join(''):''}
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
    <button class="ghost full" data-go="forgot-password">نسيت كلمة المرور؟</button>
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

  if(isAnonymousUser())return agentAuthChoice();

  const requestedAgent=session?.user?.user_metadata?.requested_role==='agent';
  if(profile?.role==='customer'&&requestedAgent){
    const meta=session.user.user_metadata||{};
    const applied=await supabase.rpc('apply_as_agent');
    if(applied.error)return toast(applied.error.message,true);

    if(meta.full_name||meta.phone){
      await supabase.rpc('update_my_profile',{
        p_full_name:String(meta.full_name||profile?.full_name||''),
        p_phone:String(meta.phone||profile?.phone||''),
        p_locale:'ar',
        p_email:session?.user?.email||''
      });
    }
    if(meta.governorate){
      await supabase.rpc('replace_agent_coverage',{
        p_governorate:String(meta.governorate),
        p_district:String(meta.district||'')
      });
    }
    await load();
  }

  if(profile?.role==='customer'){
    app.innerHTML=shell(`<section class="card narrow">
      <h2>أنت داخل كعميل</h2>
      <p>اخرج من حساب العميل أولاً إذا بدك تدخل أو تسجل كوكيل.</p>
      <button class="primary full" data-go="customer">لوحة العميل</button>
      <button class="secondary full" data-customer-logout>تسجيل الخروج</button>
    </section>`);
    return bind();
  }
  if(profile?.role==='admin')return go('admin');

  const {data:a}=await supabase.from('agent_profiles').select('*').eq('user_id',session.user.id).maybeSingle();

  if(!a){
    app.innerHTML=shell(`<section class="card narrow">
      <div class="title"><h2>إكمال طلب الوكيل</h2><button data-agent-logout>تسجيل الخروج</button></div>
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
      <div class="title"><h2>طلب الوكيل</h2><button data-agent-logout>تسجيل الخروج</button></div>
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
        <button class="ghost" data-agent-logout>تسجيل الخروج</button>
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
  const [{data:rows,error},{data:events},{data:docs},{data:deliverables},{data:workflow},{data:requirements}]=await Promise.all([
    supabase.rpc('get_agent_job',{p_order_id:id}),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).order('created_at'),
    supabase.from('order_deliverables').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('order_workflow_steps').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('order_requirements').select('*').eq('order_id',id).order('created_at')
  ]);
  const o=rows?.[0];
  if(error||!o)return toast(error?.message||'تعذر فتح الطلب',true);
  const pendingStep=(workflow||[]).find(x=>!x.completed_at);
  const next=o.status==='completed'||o.status==='cancelled'
    ?null
    :pendingStep
      ?[pendingStep.status,pendingStep.label_ar]
      :['completed','إكمال الطلب'];
  const finalDocs=(docs||[]).filter(x=>x.kind==='final_document'&&x.deliverable_id);
  const docByDeliverable=Object.fromEntries(finalDocs.map(x=>[x.deliverable_id,x]));
  const docById=Object.fromEntries((docs||[]).map(x=>[x.id,x]));
  const missingDeliverables=(deliverables||[]).filter(x=>!docByDeliverable[x.id]);

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

    ${(requirements||[]).length?`<h3>معلومات العميل</h3>
      <div class="requirements agentrequirements">
        ${(requirements||[]).map(r=>{
          const d=r.document_id?docById[r.document_id]:null;
          return `<div class="requirement done">
            <div><b>${esc(r.label_ar)}</b><small>${r.value_text?esc(r.value_text):(d?esc(d.original_name||'مرفق'):(r.required?'مطلوب':'لم يقدّم'))}</small></div>
            ${d?`<button class="secondary compact" data-download="${esc(d.storage_path)}">فتح</button>`:'<span class="reqdone">✓</span>'}
          </div>`;
        }).join('')}
      </div>`:''}
    ${(deliverables||[]).length?`<h3>المطلوب تسليمه</h3>
      <div class="deliverychecklist">
        ${deliverables.map(x=>{
          const d=docByDeliverable[x.id];
          return `<div class="deliveryitem ${d?'done':''}">
            <div class="deliverylabel"><span class="deliverystatus">${d?'✓':'○'}</span><span><b>${esc(x.service_name_ar)}</b><small>${d?'تم رفع المستند النهائي':'بانتظار المستند النهائي'}</small></span></div>
            <div class="deliveryactions">
              ${d?`<button class="secondary compact" data-download="${esc(d.storage_path)}">فتح</button>`:''}
              <input id="deliverable-file-${x.id}" type="file" accept=".pdf,image/jpeg,image/png,image/webp">
              <button class="secondary compact" data-deliverable-upload="${x.id}" data-order-id="${o.id}" data-old-path="${esc(d?.storage_path||'')}">${d?'استبدال':'رفع'}</button>
            </div>
          </div>`;
        }).join('')}
      </div>`:''}

    ${(workflow||[]).length?`<h3>مراحل التنفيذ</h3>
      <div class="workflowchecklist">
        ${workflow.map((x,idx)=>`<div class="workflowstep ${x.completed_at?'done':(!x.completed_at&&workflow.findIndex(w=>!w.completed_at)===idx?'current':'')}">
          <span>${x.completed_at?'✓':(!x.completed_at&&workflow.findIndex(w=>!w.completed_at)===idx?'•':'○')}</span>
          <b>${esc(x.label_ar)}</b>
        </div>`).join('')}
      </div>`:''}

    <h3>التتبّع</h3>
    <div class="timeline">${(events||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>

    ${next?`
      ${next[0]==='completed'&&missingDeliverables.length?`<div class="completebox requirementgate"><span class="completecheck">!</span><div><b>أكمل المستندات النهائية</b><small>باقي ${missingDeliverables.length} مستند قبل إكمال الطلب.</small></div></div>`:''}
      <button class="primary full next-action" data-status="${next[0]}" data-id="${o.id}" ${next[0]==='completed'&&missingDeliverables.length?'disabled':''}>${next[1]}</button>
    `:'<div class="donebox">تم إكمال الطلب</div>'}
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
  const [{data:a},{data:s},{data:o},{data:reqs},{data:disputes},{data:workflow},{data:bundles}]=await Promise.all([
    supabase.from('agent_profiles').select('*').order('created_at',{ascending:false}),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(50),
    supabase.from('service_requirements').select('*').order('sort_order'),
    supabase.from('disputes').select('*').in('status',['open','reviewing']).order('created_at',{ascending:false}).limit(20),
    supabase.from('service_workflow_steps').select('*').order('sort_order'),
    supabase.from('service_bundle_items').select('*').order('sort_order')
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
    <h3>الدعم</h3>
    <div class="stack">${(disputes||[]).map(d=>`<button class="row" data-admin-dispute="${d.id}">
      <span><b>طلب دعم</b><small>${esc(d.reason)}</small></span>
      <i>${d.status==='reviewing'?'قيد المراجعة':'جديد'}</i>
    </button>`).join('')||'<div class="empty">لا توجد طلبات دعم مفتوحة.</div>'}</div>

    <h3>الخدمات والتسعير</h3>
    <div class="stack">${renderServicesAdmin(s||[],reqs||[],workflow||[],bundles||[])}</div>
    <h3>آخر الطلبات</h3>
    <div class="stack">${(o||[]).map(x=>`<button class="row" data-admin-order="${x.id}"><span><b>${x.public_code}</b><small>${esc(x.cadastral_area)} • ${esc(x.property_number)}</small></span><i>${labels[x.status]}</i></button>`).join('')}</div>
  </section>`);
  bind();
}
async function adminDispute(id){
  clearLive();
  if(profile?.role!=='admin')return go('home');

  const {data:d,error}=await supabase.from('disputes').select('*').eq('id',id).single();
  if(error||!d)return toast(error?.message||'تعذر فتح طلب الدعم',true);

  const [{data:o},{data:p}]=await Promise.all([
    supabase.from('orders').select('*').eq('id',d.order_id).single(),
    supabase.from('profiles').select('full_name,email,phone').eq('id',d.opened_by).maybeSingle()
  ]);

  app.innerHTML=shell(`<section class="card">
    <div class="title"><h2>طلب دعم</h2><button data-go="admin">رجوع</button></div>

    <div class="jobinfo">
      <div><small>الطلب</small><b>${esc(o?.public_code||'—')}</b></div>
      <div><small>العميل</small><b>${esc(p?.full_name||o?.customer_name||'—')}</b></div>
      <div><small>الهاتف</small><b>${esc(p?.phone||o?.customer_phone||'—')}</b></div>
      <div><small>الحالة</small><b>${d.status==='open'?'جديد':d.status==='reviewing'?'قيد المراجعة':d.status==='resolved'?'تم الحل':'مغلق'}</b></div>
    </div>

    <h3>المشكلة</h3>
    <div class="feedbackdone"><b>${esc(d.reason)}</b><small>${new Date(d.created_at).toLocaleString('ar-LB')}</small></div>

    ${d.resolution?`<h3>الرد</h3><div class="feedbackdone"><b>رد الإدارة</b><small>${esc(d.resolution)}</small></div>`:''}

    ${['open','reviewing'].includes(d.status)?`
      <form id="disputeResolutionForm" data-dispute-id="${d.id}">
        <textarea name="resolution" placeholder="اكتب الرد أو الحل"></textarea>
        <div class="supportactions">
          ${d.status==='open'?`<button type="button" class="secondary" data-dispute-reviewing="${d.id}">بدء المراجعة</button>`:''}
          <button class="primary" name="action" value="resolved">حل الطلب</button>
          <button class="secondary" name="action" value="closed">إغلاق</button>
        </div>
      </form>
    `:''}

    ${o?`<button class="secondary full" data-admin-order="${o.id}">فتح الطلب</button>`:''}
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
  const [{data:pack,error},{data:agents},{data:payments}]=await Promise.all([
    supabase.rpc('admin_get_order',{p_order_id:id}),
    supabase.from('agent_profiles').select('user_id,verification_status').eq('verification_status','approved'),
    supabase.from('payments').select('*').eq('order_id',id).order('created_at',{ascending:false}).limit(1)
  ]);
  if(error||!pack)return toast(error?.message||'تعذر فتح الطلب',true);

  const agentIds=(agents||[]).map(x=>x.user_id),agentNames={};
  if(agentIds.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',agentIds);
    (p||[]).forEach(x=>agentNames[x.id]=x);
  }
  const o=pack.order,items=pack.items||[],events=pack.events||[],docs=pack.documents||[],reqs=pack.requirements||[];
  const payment=payments?.[0];
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

    <h3>الدفع</h3>
    <div class="adminrow paymentadmin">
      <span>
        <b>${money(payment?.amount??o.total_amount)}</b>
        <small>${o.refund_pending?'رد المبلغ قيد المعالجة':payment?.status==='paid'?'مدفوع':payment?.status==='refunded'?'تم رد المبلغ':payment?.status==='failed'?'فشل الدفع':'بانتظار الدفع'}</small>
      </span>
      <div class="paymentactions">
        ${payment&&['pending','failed'].includes(payment.status)?`<button class="secondary compact" data-mark-payment-paid="${payment.id}" data-order-id="${o.id}">تسجيل مدفوع</button>`:''}
        ${payment&&payment.status==='paid'&&o.status==='cancelled'?`<button class="secondary compact" data-mark-payment-refunded="${payment.id}" data-order-id="${o.id}">تسجيل رد المبلغ</button>`:''}
      </div>
    </div>

    <h3>إدارة الطلب</h3>
    <form id="adminStatusForm">
      <select name="status">
        ${Object.entries(labels).filter(([k])=>k!=='cancelled').map(([k,v])=>`<option value="${k}" ${o.status===k?'selected':''}>${v}</option>`).join('')}
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
  const anonymous=isAnonymousUser();

  if(new URLSearchParams(location.search).get('password-reset')==='1'&&!anonymous){
    return resetPasswordPage();
  }

  // Home is the public role chooser only when signed out.
  // Signed-in users always land on their own dashboard.
  if(r==='home'){
    if(anonymous){app.innerHTML=home();return bind()}
    if(profile?.role==='customer')return customerPortal();
    if(profile?.role==='agent')return agentPortal();
    if(profile?.role==='admin')return admin();
    app.innerHTML=home();return bind();
  }

  if(r==='account'){
    if(anonymous)return go('home');
    return accountPage();
  }

  if(r==='forgot-password')return forgotPasswordPage();

  if(r==='customer'){
    if(anonymous)return customerAuthChoice();
    if(profile?.role==='customer')return customerPortal();
    if(profile?.role==='agent')return agentPortal();
    if(profile?.role==='admin')return admin();
    return customerAuthChoice();
  }

  if(r==='customer-login'){
    if(!anonymous)return go('home');
    app.innerHTML='';
    return customerLogin();
  }

  if(r==='customer-register'){
    if(!anonymous)return go('home');
    app.innerHTML='';
    return customerRegister();
  }

  if(r==='new'){
    if(anonymous)return customerAuthChoice();
    if(profile?.role!=='customer')return go('home');
    const out=newOrder();
    if(typeof out==='string'){app.innerHTML=out;bind()}
    return;
  }

  if(r==='orders'){
    if(anonymous)return customerAuthChoice();
    if(profile?.role!=='customer')return go('home');
    return orders();
  }

  if(r==='agent'){
    if(anonymous)return agentAuthChoice();
    if(profile?.role==='customer')return agentPortal();
    if(profile?.role==='admin')return admin();
    return agentPortal();
  }

  if(r==='agent-login'){
    if(!anonymous)return go('home');
    app.innerHTML='';
    return agentLogin();
  }

  if(r==='agent-register'){
    if(!anonymous)return go('home');
    app.innerHTML='';
    return agentRegister();
  }

  if(r==='staff')return staffAccess();
  if(r==='admin')return profile?.role==='admin'?admin():staffAccess();
  if(r.startsWith('admin-dispute/'))return profile?.role==='admin'?adminDispute(r.split('/')[1]):staffAccess();
  if(r.startsWith('admin-agent/'))return profile?.role==='admin'?adminAgent(r.split('/')[1]):staffAccess();
  if(r.startsWith('admin-order/'))return profile?.role==='admin'?adminOrder(r.split('/')[1]):staffAccess();

  return go('home');
}
function bind(){
  document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>go(x.dataset.go));

  const customerLoginForm=document.querySelector('#customerLogin');
  if(customerLoginForm)customerLoginForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(customerLoginForm),b=customerLoginForm.querySelector('button');
    busy(b,true,'جارٍ الدخول...');
    await supabase.auth.signOut();
    const {data,error}=await supabase.auth.signInWithPassword({
      email:String(f.get('email')||'').trim(),
      password:String(f.get('password')||'')
    });
    if(error){
      busy(b,false);
      if(error.code==='email_not_confirmed'||/email not confirmed/i.test(error.message||'')){
        const email=String(f.get('email')||'').trim();
        app.innerHTML=shell(`<section class="card narrow pending">
          <h2>فعّل بريدك أولاً</h2>
          <p>أرسلنا رسالة تأكيد إلى <b>${esc(email)}</b>. افتحها واضغط رابط التفعيل، ثم ارجع وسجّل الدخول.</p>
          <button class="secondary full" data-resend-customer-confirm="${esc(email)}">إعادة إرسال رسالة التفعيل</button>
          <button class="primary full" data-go="customer-login">رجوع للدخول</button>
        </section>`);
        bind();
        return;
      }
      return toast('البريد أو كلمة المرور غير صحيحة.',true)
    }
    session=data.session;
    await load();
    busy(b,false);
    if(profile?.role==='agent'){toast('هذا حساب وكيل');return go('agent')}
    if(profile?.role==='admin')return go('admin');
    toast('تم تسجيل الدخول');
    go('customer');
  };

  document.querySelectorAll('[data-resend-customer-confirm]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ الإرسال...');
    const {error}=await supabase.auth.resend({
      type:'signup',
      email:x.dataset.resendCustomerConfirm,
      options:{emailRedirectTo:'https://bachirban92.github.io/3annak/#customer'}
    });
    busy(x,false);
    error?toast(error.message,true):toast('تم إرسال رسالة التفعيل من جديد');
  });

  const customerRegisterForm=document.querySelector('#customerRegister');
  if(customerRegisterForm)customerRegisterForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(customerRegisterForm),b=customerRegisterForm.querySelector('button');
    const email=String(f.get('email')||'').trim();
    const password=String(f.get('password')||'');
    busy(b,true,'جارٍ إنشاء الحساب...');
    await supabase.auth.signOut();
    const {data,error}=await supabase.auth.signUp({
      email,
      password,
      options:{
        data:{full_name:String(f.get('name')||''),phone:String(f.get('phone')||''),requested_role:'customer'},
        emailRedirectTo:'https://bachirban92.github.io/3annak/#customer'
      }
    });
    if(error){busy(b,false);return toast(error.message,true)}
    if(!data.session){
      busy(b,false);
      app.innerHTML=shell('<section class="card narrow pending"><h2>تم إنشاء الحساب</h2><p>افتح بريدك لتأكيد الحساب، ثم سجّل الدخول لمتابعة طلباتك.</p><button class="primary full" data-go="customer-login">دخول العميل</button></section>');
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
    busy(b,false);
    if(contact.error)return toast(contact.error.message,true);
    await load();
    toast('تم إنشاء الحساب');
    go('customer');
  };

  document.querySelectorAll('[data-customer-logout]').forEach(x=>x.onclick=async()=>{
    await supabase.auth.signOut({scope:'local'});
    session=null;profile=null;
    await load();
    go('home');
  });

  const accountProfileForm=document.querySelector('#accountProfileForm');
  if(accountProfileForm)accountProfileForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(accountProfileForm),b=accountProfileForm.querySelector('button');
    busy(b,true,'جارٍ الحفظ...');
    const {data,error}=await supabase.rpc('update_my_profile',{
      p_full_name:String(f.get('name')||'').trim(),
      p_phone:String(f.get('phone')||'').trim(),
      p_locale:'ar',
      p_email:session?.user?.email||profile?.email||''
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    profile=data;
    toast('تم حفظ معلومات الحساب');
    accountPage();
  };

  const accountPasswordForm=document.querySelector('#accountPasswordForm');
  if(accountPasswordForm)accountPasswordForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(accountPasswordForm),b=accountPasswordForm.querySelector('button');
    const password=String(f.get('password')||''),confirm=String(f.get('confirm')||'');
    if(password!==confirm)return toast('كلمتا المرور غير متطابقتين',true);
    busy(b,true,'جارٍ التغيير...');
    const {error}=await supabase.auth.updateUser({password});
    busy(b,false);
    error?toast(error.message,true):toast('تم تغيير كلمة المرور');
    if(!error)accountPasswordForm.reset();
  };

  document.querySelectorAll('[data-account-logout]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ تسجيل الخروج...');
    await supabase.auth.signOut({scope:'local'});
    session=null;profile=null;
    history.replaceState(null,'',location.pathname);
    await load();
    go('home');
  });

  const forgotPasswordForm=document.querySelector('#forgotPasswordForm');
  if(forgotPasswordForm)forgotPasswordForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(forgotPasswordForm),b=forgotPasswordForm.querySelector('button');
    busy(b,true,'جارٍ الإرسال...');
    const {error}=await supabase.auth.resetPasswordForEmail(
      String(f.get('email')||'').trim(),
      {redirectTo:'https://bachirban92.github.io/3annak/?password-reset=1'}
    );
    busy(b,false);
    if(error)return toast(error.message,true);
    app.innerHTML=shell('<section class="card narrow pending"><h2>تحقق من بريدك</h2><p>إذا كان الحساب موجوداً، أرسلنا رابطاً لتعيين كلمة مرور جديدة.</p><button class="primary full" data-go="home">رجوع</button></section>');
    bind();
  };

  const resetPasswordForm=document.querySelector('#resetPasswordForm');
  if(resetPasswordForm)resetPasswordForm.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(resetPasswordForm),b=resetPasswordForm.querySelector('button');
    const password=String(f.get('password')||''),confirm=String(f.get('confirm')||'');
    if(password!==confirm)return toast('كلمتا المرور غير متطابقتين',true);
    busy(b,true,'جارٍ الحفظ...');
    const {error}=await supabase.auth.updateUser({password});
    busy(b,false);
    if(error)return toast(error.message,true);
    history.replaceState(null,'',location.pathname);
    toast('تم تغيير كلمة المرور');
    await load();
    go('home');
  };

  document.querySelectorAll('[data-resend-agent-confirm]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ الإرسال...');
    const {error}=await supabase.auth.resend({
      type:'signup',
      email:x.dataset.resendAgentConfirm,
      options:{emailRedirectTo:'https://bachirban92.github.io/3annak/#agent'}
    });
    busy(x,false);
    error?toast(error.message,true):toast('تم إرسال رسالة التفعيل من جديد');
  });

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
    if(error){
      busy(b,false);
      if(error.code==='email_not_confirmed'||/email not confirmed/i.test(error.message||'')){
        const email=String(f.get('email')||'').trim();
        app.innerHTML=shell(`<section class="card narrow pending">
          <h2>فعّل بريدك أولاً</h2>
          <p>أرسلنا رسالة تأكيد إلى <b>${esc(email)}</b>. فعّل الحساب ثم ارجع وسجّل الدخول.</p>
          <button class="secondary full" data-resend-agent-confirm="${esc(email)}">إعادة إرسال رسالة التفعيل</button>
          <button class="primary full" data-go="agent-login">رجوع للدخول</button>
        </section>`);
        bind();
        return;
      }
      return toast('البريد أو كلمة المرور غير صحيحة.',true)
    }
    session=data.session;
    await load();
    if(profile?.role==='customer'&&session?.user?.user_metadata?.requested_role!=='agent'){
      busy(b,false);
      toast('هذا حساب عميل',true);
      return go('customer');
    }
    toast('تم تسجيل الدخول');
    go('agent');
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
      options:{
        data:{
          full_name:String(f.get('name')||''),
          phone:String(f.get('phone')||''),
          requested_role:'agent',
          governorate:String(f.get('governorate')||''),
          district:String(f.get('district')||'')
        },
        emailRedirectTo:'https://bachirban92.github.io/3annak/#agent'
      }
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
    await supabase.auth.signOut({scope:'local'});
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

  const ratingForm=document.querySelector('#ratingForm');
  if(ratingForm)ratingForm.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(ratingForm),b=ratingForm.querySelector('button');
    busy(b,true);
    const {error}=await supabase.rpc('submit_rating',{
      p_order_id:ratingForm.dataset.orderId,
      p_rating:+d.get('rating'),
      p_comment:d.get('comment')||''
    });
    busy(b,false);
    error?toast(error.message,true):(toast('شكراً لتقييمك'),customerDetail(ratingForm.dataset.orderId));
  };

  const supportForm=document.querySelector('#supportForm');
  if(supportForm)supportForm.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(supportForm),b=supportForm.querySelector('button');
    const reason=String(d.get('reason')||'').trim();
    if(reason.length<3)return toast('اشرح المشكلة باختصار',true);
    busy(b,true);
    const {error}=await supabase.rpc('open_dispute',{
      p_order_id:supportForm.dataset.orderId,
      p_reason:reason
    });
    busy(b,false);
    if(error){
      const msg=error.message==='dispute_already_open'?'يوجد طلب دعم مفتوح لهذا الطلب':error.message;
      return toast(msg,true);
    }
    toast('تم إرسال طلب الدعم');
    customerDetail(supportForm.dataset.orderId);
  };

  bindServiceSelection({services,bundleItems,serviceRequirements,money,toast});
  const order=document.querySelector('#order');
  if(order)order.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(order),b=order.querySelector('#orderSubmit')||order.querySelector('button');
    busy(b,true,'جارٍ إنشاء الطلب...');

    const contact=await supabase.rpc('update_my_profile',{
      p_full_name:f.get('name')||'',
      p_phone:f.get('phone')||'',
      p_locale:'ar',
      p_email:f.get('email')||''
    });
    if(contact.error){busy(b,false);return toast(contact.error.message,true)}
    profile=contact.data;

    const {data,error}=await supabase.rpc('create_order',{
      p_customer_name:f.get('name')||'',
      p_customer_phone:f.get('phone'),
      p_customer_email:f.get('email')||'',
      p_governorate:f.get('governorate'),
      p_district:f.get('district')||'',
      p_cadastral_area:f.get('cadastral_area'),
      p_property_number:f.get('property_number'),
      p_property_section:f.get('property_section')||'',
      p_notes:f.get('notes')||'',
      p_service_codes:f.getAll('service')
    });

    if(error){busy(b,false);return toast(error.message,true)}

    const orderId=data?.[0]?.order_id;
    if(!orderId){busy(b,false);return toast('تعذر إنشاء الطلب',true)}

    const {data:orderReqs,error:reqError}=await supabase
      .from('order_requirements')
      .select('*')
      .eq('order_id',orderId);

    if(reqError){
      busy(b,false);
      toast('تم إنشاء الطلب، لكن تعذر حفظ بعض المتطلبات',true);
      return customerDetail(orderId);
    }

    for(const req of orderReqs||[]){
      const input=order.querySelector(`[data-pre-req-code="${CSS.escape(req.code)}"]`);
      if(!input)continue;

      if(req.requirement_type==='text'){
        const value=String(input.value||'').trim();
        if(!value)continue;
        const done=await supabase.rpc('complete_order_requirement',{
          p_order_requirement_id:req.id,
          p_value_text:value,
          p_document_id:null
        });
        if(done.error){
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر حفظ '+req.label_ar,true);
          return customerDetail(orderId);
        }
      }else if(req.requirement_type==='file'){
        const file=input.files?.[0];
        if(!file)continue;
        if(file.size>10*1024*1024){
          busy(b,false);
          toast('تم إنشاء الطلب، لكن الملف أكبر من 10MB',true);
          return customerDetail(orderId);
        }
        if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)){
          busy(b,false);
          toast('تم إنشاء الطلب، لكن نوع الملف غير مدعوم',true);
          return customerDetail(orderId);
        }

        const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const path=orderId+'/'+crypto.randomUUID()+'-'+safe;
        const up=await supabase.storage.from('order-files').upload(path,file);
        if(up.error){
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر رفع '+req.label_ar,true);
          return customerDetail(orderId);
        }

        const ins=await supabase.from('documents').insert({
          order_id:orderId,
          kind:'customer_attachment',
          storage_path:path,
          original_name:file.name,
          mime_type:file.type,
          file_size:file.size,
          visible_to_customer:true,
          uploaded_by:session.user.id
        }).select('id').single();

        if(ins.error){
          await supabase.storage.from('order-files').remove([path]);
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر حفظ '+req.label_ar,true);
          return customerDetail(orderId);
        }

        const done=await supabase.rpc('complete_order_requirement',{
          p_order_requirement_id:req.id,
          p_value_text:null,
          p_document_id:ins.data.id
        });
        if(done.error){
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر إكمال '+req.label_ar,true);
          return customerDetail(orderId);
        }
      }
    }

    busy(b,false);
    toast('تم تأكيد الطلب');
    customerDetail(orderId);
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
  document.querySelectorAll('[data-admin-dispute]').forEach(x=>x.onclick=()=>go('admin-dispute/'+x.dataset.adminDispute));
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
    if(error){
      busy(x,false);
      const msg=error.message==='deliverables_incomplete'?'أكمل المستندات النهائية أولاً':
        error.message==='workflow_incomplete'?'أكمل مراحل التنفيذ أولاً':error.message;
      toast(msg,true);
    }else{toast('تم تحديث الحالة');agentJob(x.dataset.id)}
  });

  document.querySelectorAll('[data-deliverable-upload]').forEach(x=>x.onclick=async()=>{
    const input=document.querySelector('#deliverable-file-'+x.dataset.deliverableUpload);
    const file=input?.files?.[0];
    if(!file)return toast('اختر المستند أولاً',true);
    if(file.size>10*1024*1024)return toast('الحد الأقصى للملف 10MB',true);
    if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))return toast('نوع الملف غير مدعوم',true);

    busy(x,true,'جارٍ الرفع...');
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path=x.dataset.orderId+'/'+crypto.randomUUID()+'-'+safe;
    const up=await supabase.storage.from('order-files').upload(path,file);
    if(up.error){busy(x,false);return toast(up.error.message,true)}

    const saved=await supabase.rpc('submit_order_deliverable',{
      p_deliverable_id:x.dataset.deliverableUpload,
      p_storage_path:path,
      p_original_name:file.name,
      p_mime_type:file.type,
      p_file_size:file.size
    });

    if(saved.error){
      await supabase.storage.from('order-files').remove([path]);
      busy(x,false);
      return toast(saved.error.message,true);
    }

    const old=x.dataset.oldPath;
    if(old&&old!==path)await supabase.storage.from('order-files').remove([old]);
    busy(x,false);
    toast('تم رفع المستند');
    agentJob(x.dataset.orderId);
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
  document.querySelectorAll('[data-dispute-reviewing]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('admin_update_dispute',{
      p_dispute_id:x.dataset.disputeReviewing,
      p_status:'reviewing',
      p_resolution:null
    });
    busy(x,false);
    error?toast(error.message,true):(toast('تم بدء المراجعة'),adminDispute(x.dataset.disputeReviewing));
  });

  const disputeResolution=document.querySelector('#disputeResolutionForm');
  if(disputeResolution)disputeResolution.onsubmit=async e=>{
    e.preventDefault();
    const d=new FormData(disputeResolution);
    const action=e.submitter?.value||'resolved';
    const resolution=String(d.get('resolution')||'').trim();
    if(resolution.length<2)return toast('اكتب الرد أو الحل',true);
    const b=e.submitter;
    busy(b,true);
    const {error}=await supabase.rpc('admin_update_dispute',{
      p_dispute_id:disputeResolution.dataset.disputeId,
      p_status:action,
      p_resolution:resolution
    });
    busy(b,false);
    error?toast(error.message,true):(toast(action==='resolved'?'تم حل طلب الدعم':'تم إغلاق طلب الدعم'),adminDispute(disputeResolution.dataset.disputeId));
  };

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

  document.querySelectorAll('[data-mark-payment-paid]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('admin_mark_payment_paid',{
      p_payment_id:x.dataset.markPaymentPaid,
      p_provider:'manual',
      p_provider_reference:null
    });
    busy(x,false);
    error?toast(error.message,true):(toast('تم تسجيل الدفع'),adminOrder(x.dataset.orderId));
  });

  document.querySelectorAll('[data-mark-payment-refunded]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('admin_mark_payment_refunded',{
      p_payment_id:x.dataset.markPaymentRefunded,
      p_provider_reference:null
    });
    busy(x,false);
    error?toast(error.message,true):(toast('تم تسجيل رد المبلغ'),adminOrder(x.dataset.orderId));
  });

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
