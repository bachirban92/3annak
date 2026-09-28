import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderRequirements, bindRequirementActions } from './requirements.js';
import { renderServicesAdmin, bindServicesAdmin } from './service-admin.js';
import { renderNewOrder, bindServiceSelection } from './order-form.js';

const app=document.querySelector('#app');
let session=null,profile=null,services=[],bundleItems=[],serviceRequirements=[],customerProperties=[],customerAddresses=[],deliveryConfig={enabled:false,customer_fee:0,agent_payout:0},paymentsEnabled=false,liveChannel=null;
let passwordRecoveryMode=location.hash.includes('type=recovery')||new URLSearchParams(location.search).get('password-reset')==='1';

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
  session=s||null;

  const profileQuery=session
    ?supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle()
    :Promise.resolve({data:null});
  const bundlesQuery=session
    ?supabase.from('service_bundle_items').select('*').order('sort_order')
    :Promise.resolve({data:[]});
  const propertiesQuery=session
    ?supabase.from('customer_properties').select('*').order('is_default',{ascending:false}).order('created_at',{ascending:false})
    :Promise.resolve({data:[]});
  const addressesQuery=session
    ?supabase.from('customer_addresses').select('*').order('is_default',{ascending:false}).order('created_at',{ascending:false})
    :Promise.resolve({data:[]});

  const [{data:p},{data:srv},{data:bundles},{data:reqCatalog},{data:savedProps},{data:savedAddresses},{data:deliverySetting},{data:paymentSetting}]=await Promise.all([
    profileQuery,
    supabase.from('services').select('*').eq('active',true).order('sort_order'),
    bundlesQuery,
    supabase.from('service_requirements').select('*').eq('active',true).order('sort_order'),
    propertiesQuery,
    addressesQuery,
    supabase.from('app_settings').select('value').eq('key','hard_copy_delivery').maybeSingle(),
    supabase.from('app_settings').select('value').eq('key','payments_enforced').maybeSingle()
  ]);

  profile=p||null;
  services=srv||[];
  bundleItems=bundles||[];
  serviceRequirements=reqCatalog||[];
  customerProperties=savedProps||[];
  customerAddresses=savedAddresses||[];
  deliveryConfig=deliverySetting?.value||{enabled:false,customer_fee:0,agent_payout:0};
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

  const {data:allOrders,error}=await supabase
    .from('orders').select('*')
    .eq('customer_id',session.user.id)
    .order('created_at',{ascending:false});
  if(error)return toast(error.message,true);

  const rows=allOrders||[];
  const current=rows.filter(o=>!['completed','cancelled'].includes(o.status));
  const completed=rows.filter(o=>o.status==='completed');
  const currentIds=current.map(o=>o.id);

  let reqRows=[],paymentRows=[];
  if(currentIds.length){
    const [r,p]=await Promise.all([
      supabase.from('order_requirements').select('id,order_id,required,completed_at').in('order_id',currentIds).eq('required',true),
      supabase.from('payments').select('order_id,status,provider,created_at').in('order_id',currentIds).order('created_at',{ascending:false})
    ]);
    if(r.error)return toast(r.error.message,true);
    if(p.error)return toast(p.error.message,true);
    reqRows=r.data||[];
    paymentRows=p.data||[];
  }

  const missingByOrder={};
  for(const r of reqRows){
    if(!r.completed_at)missingByOrder[r.order_id]=(missingByOrder[r.order_id]||0)+1;
  }
  const paymentByOrder={};
  for(const p of paymentRows){if(!paymentByOrder[p.order_id])paymentByOrder[p.order_id]=p;}
  const needsCustomerAction=o=>(missingByOrder[o.id]||0)>0||o.customer_submission_ready===false;
  const actionCount=current.filter(needsCustomerAction).length;

  const orderState=o=>{
    const missing=missingByOrder[o.id]||0;
    if(missing)return {kind:'action',title:'مطلوب منك',text:`أكمل ${missing} عنصر مطلوب`};
    if(o.customer_submission_ready===false)return {kind:'action',title:'مطلوب منك',text:'أرسل الطلب للوكلاء بعد مراجعة البيانات'};
    if(o.refund_pending)return {kind:'waiting',title:'قيد المعالجة',text:'رد المبلغ قيد المعالجة'};
    if(o.status==='submitted'&&!o.assigned_agent_id)return {kind:'waiting',title:'بانتظار وكيل',text:'سنظهر الطلب للوكلاء المؤهلين'};
    if(o.assigned_agent_id&&o.status==='accepted'&&paymentByOrder[o.id]?.status!=='paid')return {kind:'waiting',title:'تم تعيين وكيل',text:'الوكيل يعمل على طلبك • الدفع نقداً عند الانتهاء'};
    if(o.assigned_agent_id&&o.status==='accepted')return {kind:'ok',title:'تم تعيين وكيل',text:'تم تأكيد الدفع'};
    return {kind:'waiting',title:labels[o.status]||o.status,text:o.expected_ready_at?`متوقع ${new Date(o.expected_ready_at).toLocaleDateString('ar-LB')}`:''};
  };

  app.innerHTML=shell(`<section class="role-dashboard">
    ${customerNav('home')}
    <div class="role-dashboard-bar">
      <div><small>حساب العميل</small><h2>${esc(profile?.full_name||session?.user?.email||'')}</h2></div>
      <button class="ghost" data-customer-logout>تسجيل الخروج</button>
    </div>

    <div class="role-dashboard-actions">
      <button class="primary" data-go="new">طلب جديد</button>
      <button class="secondary" data-go="orders">كل الطلبات</button>
      <button class="secondary" data-go="account">حسابي</button>
    </div>

    <div class="role-metrics">
      <div><small>جارية</small><b>${current.length}</b></div>
      <div><small>تحتاج إجراء</small><b>${actionCount}</b></div>
      <div><small>مكتملة</small><b>${completed.length}</b></div>
    </div>

    ${actionCount?`<section class="dashboard-panel attention-panel">
      <div class="dashboard-panel-head"><h3>مطلوب منك</h3></div>
      <div class="stack">
        ${current.filter(needsCustomerAction).map(o=>`<button class="action-row" data-order="${o.id}">
          <span><b>${o.public_code}</b><small>${(missingByOrder[o.id]||0)>0?`أكمل ${missingByOrder[o.id]} عنصر مطلوب`:o.customer_submission_ready===false?'راجع البيانات وأرسل الطلب للوكلاء':'أكمل الدفع ليبدأ الوكيل التنفيذ'}</small></span>
          <strong>فتح</strong>
        </button>`).join('')}
      </div>
    </section>`:''}

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>الطلبات الجارية</h3><button data-go="orders">عرض الكل</button></div>
      <div class="stack">
        ${current.slice(0,8).map(o=>{const st=orderState(o);return `<button class="order-dashboard-row" data-order="${o.id}">
          <span class="order-dashboard-main"><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span>
          <span class="order-dashboard-state ${st.kind}"><b>${esc(st.title)}</b><small>${esc(st.text)}</small></span>
        </button>`}).join('')||'<div class="empty">لا يوجد طلبات جارية.</div>'}
      </div>
    </section>
  </section>`);
  bind();

  liveChannel=supabase.channel('customer-dashboard-'+session.user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`customer_id=eq.${session.user.id}`},()=>customerPortal())
    .on('postgres_changes',{event:'*',schema:'public',table:'order_requirements'},payload=>{
      if(currentIds.includes(payload.new?.order_id||payload.old?.order_id))customerPortal();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'payments'},payload=>{
      if(currentIds.includes(payload.new?.order_id||payload.old?.order_id))customerPortal();
    })
    .subscribe();
}
function customerNav(active='home'){
  return `<nav class="role-nav">
    <button class="${active==='home'?'active':''}" data-go="customer">الرئيسية</button>
    <button class="${active==='orders'?'active':''}" data-go="orders">طلباتي</button>
    <button class="${active==='properties'?'active':''}" data-go="properties">عقاراتي</button>
    <button class="${active==='documents'?'active':''}" data-go="documents">المستندات</button>
    <button class="${active==='account'?'active':''}" data-go="account">حسابي</button>
  </nav>`;
}

function agentNav(active='home'){
  return `<nav class="role-nav agent-role-nav">
    <button class="${active==='home'?'active':''}" data-go="agent">الرئيسية</button>
    <button class="${active==='earnings'?'active':''}" data-go="agent-earnings">الأرباح</button>
    <button class="${active==='account'?'active':''}" data-go="account">حسابي</button>
  </nav>`;
}

async function customerPropertiesPage(){
  clearLive();
  if(profile?.role!=='customer')return go('home');
  const {data,error}=await supabase.from('customer_properties').select('*').order('is_default',{ascending:false}).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  customerProperties=data||[];

  app.innerHTML=shell(`<section class="role-dashboard">
    ${customerNav('properties')}
    <div class="dashboard-panel-head"><h2>عقاراتي</h2><button class="primary compact" data-add-property>إضافة عقار</button></div>
    <div class="stack">
      ${customerProperties.map(p=>`<div class="account-list-row">
        <div><b>${esc(p.label)}</b><small>${esc(p.governorate)}${p.district?' • '+esc(p.district):''} • ${esc(p.cadastral_area)} • عقار ${esc(p.property_number)}${p.is_default?' • افتراضي':''}</small></div>
        <div class="row-actions">
          <button class="secondary compact" data-edit-property="${p.id}">تعديل</button>
          <button class="secondary compact" data-delete-property="${p.id}">حذف</button>
        </div>
      </div>`).join('')||'<div class="empty">لم تحفظ أي عقار بعد.</div>'}
    </div>
    <div id="propertyEditor"></div>
  </section>`);
  bind();
}

async function customerDocumentsPage(){
  clearLive();
  if(profile?.role!=='customer')return go('home');
  const {data:ordersData,error}=await supabase.from('orders').select('id,public_code,cadastral_area,property_number,created_at').eq('customer_id',session.user.id).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  const orderIds=(ordersData||[]).map(o=>o.id);
  let docs=[];
  if(orderIds.length){
    const r=await supabase.from('documents').select('*').in('order_id',orderIds).eq('visible_to_customer',true).eq('kind','final_document').order('created_at',{ascending:false});
    if(r.error)return toast(r.error.message,true);
    docs=r.data||[];
  }
  const byOrder=Object.fromEntries((ordersData||[]).map(o=>[o.id,o]));

  app.innerHTML=shell(`<section class="role-dashboard">
    ${customerNav('documents')}
    <h2>المستندات</h2>
    <div class="document-list">
      ${docs.map(d=>{const o=byOrder[d.order_id];return `<div class="document-row">
        <div><b>${esc(d.original_name||'مستند')}</b><small>${esc(o?.public_code||'')} • ${esc(o?.cadastral_area||'')} • ${esc(o?.property_number||'')}</small></div>
        <div class="document-actions">
          <button class="secondary compact" data-file-view="${esc(d.storage_path)}" data-file-name="${esc(d.original_name||'مستند')}" data-file-mime="${esc(d.mime_type||'')}">عرض</button>
          <button class="secondary compact" data-file-download="${esc(d.storage_path)}">تنزيل</button>
        </div>
      </div>`}).join('')||'<div class="empty">لا توجد مستندات نهائية بعد.</div>'}
    </div>
  </section>`);
  bind();
}

async function customerPaymentsPage(){
  clearLive();
  if(profile?.role!=='customer')return go('home');
  const {data:ordersData,error}=await supabase.from('orders').select('id,public_code,total_amount').eq('customer_id',session.user.id).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  const ids=(ordersData||[]).map(o=>o.id);
  let payments=[];
  if(ids.length){
    const r=await supabase.from('payments').select('*').in('order_id',ids).order('created_at',{ascending:false});
    if(r.error)return toast(r.error.message,true);
    payments=r.data||[];
  }
  const byOrder=Object.fromEntries((ordersData||[]).map(o=>[o.id,o]));
  app.innerHTML=shell(`<section class="role-dashboard">
    ${customerNav()}
    <div class="title"><h2>الدفع</h2><button data-go="account">رجوع</button></div>
    <div class="info-box"><b>طريقة الدفع الحالية: نقداً</b><small>يتم تسجيل الدفع بعد استلام المبلغ. يمكن إضافة التحويل لاحقاً.</small></div>
    <section class="dashboard-panel">
      <h3>سجل الدفع</h3>
      <div class="stack">${payments.map(p=>`<div class="account-list-row">
        <div>
          <b>${esc(byOrder[p.order_id]?.public_code||'طلب')}</b>
          <small>${p.status==='paid'&&p.paid_at?new Date(p.paid_at).toLocaleString('ar-LB'):new Date(p.created_at).toLocaleDateString('ar-LB')}</small>
        </div>
        <div>
          <b>${money(p.amount)}</b>
          <small>${p.status==='paid'?'مدفوع نقداً':p.status==='refunded'?'تم رد المبلغ':p.status==='failed'?'تعذر تسجيل الدفع':'غير مدفوع'}${p.provider_reference?' • '+esc(p.provider_reference):''}</small>
        </div>
      </div>`).join('')||'<div class="empty">لا توجد عمليات دفع.</div>'}</div>
    </section>
  </section>`);
  bind();
}

async function agentEarningsPage(){
  clearLive();
  if(profile?.role!=='agent')return go('home');
  const [{data:summary},{data:payouts},{data:ledger}]=await Promise.all([
    supabase.rpc('get_agent_balance'),
    supabase.from('payouts').select('*').eq('agent_id',session.user.id).order('created_at',{ascending:false}),
    supabase.from('agent_ledger').select('*').eq('agent_id',session.user.id).order('created_at',{ascending:false}).limit(100)
  ]);
  const bal=summary?.[0]||{pending:0,available:0,paid:0};
  app.innerHTML=shell(`<section class="role-dashboard">
    ${agentNav('earnings')}
    <h2>الأرباح</h2>
    <div class="role-metrics">
      <div><small>قيد التنفيذ</small><b>${money(bal.pending)}</b></div>
      <div><small>متاح</small><b>${money(bal.available)}</b></div>
      <div><small>مدفوع</small><b>${money(bal.paid)}</b></div>
    </div>
    <section class="dashboard-panel"><h3>الحركات</h3><div class="stack">
      ${(ledger||[]).map(x=>`<div class="account-list-row"><div><b>${x.entry_type==='job_earning'?'أجر طلب':'حركة'}</b><small>${new Date(x.created_at).toLocaleDateString('ar-LB')}</small></div><div><b>${money(x.amount)}</b><small>${x.status==='available'?'متاح':x.status==='paid'?'مدفوع':x.status==='pending'?'معلّق':'ملغى'}</small></div></div>`).join('')||'<div class="empty">لا توجد حركات بعد.</div>'}
    </div></section>
    <section class="dashboard-panel"><h3>الدفعات</h3><div class="stack">
      ${(payouts||[]).map(p=>`<div class="account-list-row"><div><b>${money(p.amount)}</b><small>${new Date(p.created_at).toLocaleDateString('ar-LB')}</small></div><small>${p.status==='paid'?'مدفوع':p.status==='pending'?'قيد الدفع':'ملغى'}</small></div>`).join('')||'<div class="empty">لا توجد دفعات بعد.</div>'}
    </div></section>
  </section>`);
  bind();
}

async function notificationsPage(){
  clearLive();
  if(isAnonymousUser())return go('home');
  const {data,error}=await supabase.from('notifications').select('*').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(100);
  if(error)return toast(error.message,true);
  const rows=data||[];
  const unread=rows.filter(x=>!x.read_at).length;

  app.innerHTML=shell(`<section class="role-dashboard">
    ${profile?.role==='customer'?customerNav():profile?.role==='agent'?agentNav():''}
    <div class="title"><div><h2>الإشعارات</h2><small>${unread?unread+' غير مقروء':'لا يوجد جديد'}</small></div><button data-go="account">رجوع</button></div>
    ${unread?`<button class="secondary compact" data-read-all-notifications>تعليم الكل كمقروء</button>`:''}
    <div class="stack">
      ${rows.map(n=>`<div class="notice ${n.read_at?'':'unread'}">
        <b>${esc(n.title)}</b>
        <small>${esc(n.body||'')}</small>
        <small>${new Date(n.created_at).toLocaleString('ar-LB')}</small>
      </div>`).join('')||'<div class="empty">لا توجد إشعارات.</div>'}
    </div>
  </section>`);
  bind();
}
async function accountPage(){
  clearLive();
  if(isAnonymousUser())return go('home');

  const isAgent=profile?.role==='agent';
  const isCustomer=profile?.role==='customer';

  const [agentRes,coverageRes,addressRes,payoutRes]=await Promise.all([
    isAgent?supabase.from('agent_profiles').select('*').eq('user_id',session.user.id).maybeSingle():Promise.resolve({data:null}),
    isAgent?supabase.from('agent_coverage').select('*').eq('agent_id',session.user.id).eq('active',true):Promise.resolve({data:[]}),
    (isCustomer||isAgent)?supabase.from('customer_addresses').select('*').order('is_default',{ascending:false}).order('created_at',{ascending:false}):Promise.resolve({data:[]}),
    isAgent?supabase.from('agent_payout_accounts').select('*').eq('user_id',session.user.id).maybeSingle():Promise.resolve({data:null})
  ]);

  const agent=agentRes.data;
  const coverage=coverageRes.data||[];
  const addresses=addressRes.data||[];
  const payout=payoutRes.data;

  app.innerHTML=shell(`<section class="accountpage">
    ${isCustomer?customerNav('account'):isAgent?agentNav('account'):''}

    <div class="title">
      <div><h2>حسابي</h2><small>${isAgent?'وكيل':isCustomer?'عميل':'إدارة'}</small></div>
      <button data-go="home">رجوع</button>
    </div>

    <section class="card">
      <h3>المعلومات الشخصية</h3>
      <form id="accountProfileForm">
        <label>الاسم<input name="name" required value="${esc(profile?.full_name||'')}"></label>
        <label>رقم الهاتف<input name="phone" value="${esc(profile?.phone||'')}"></label>
        <label>البريد الإلكتروني<input value="${esc(session?.user?.email||profile?.email||'')}" disabled></label>
        <button class="primary full">حفظ المعلومات</button>
      </form>
    </section>

    ${(isCustomer||isAgent)?`<section class="card">
      <div class="dashboard-panel-head"><h3>${isAgent?'العنوان الشخصي':'العناوين'}</h3><button class="secondary compact" data-add-address>إضافة عنوان</button></div>
      <div class="stack">
        ${addresses.map(a=>`<div class="account-list-row">
          <div><b>${esc(a.label)}</b><small>${esc(a.address_line1)} • ${esc(a.city)}${a.is_default?' • افتراضي':''}</small></div>
          <div class="row-actions">
            <button class="secondary compact" data-edit-address="${a.id}">تعديل</button>
            <button class="secondary compact" data-delete-address="${a.id}">حذف</button>
          </div>
        </div>`).join('')||'<div class="empty">لا يوجد عنوان محفوظ.</div>'}
      </div>
      <div id="addressEditor"></div>
    </section>`:''}

    ${isCustomer?`<section class="card account-links">
      <button class="account-link" data-go="payments"><span><b>الدفع</b><small>سجل الدفع وطرق الدفع عند تفعيلها</small></span><span>›</span></button>
      <button class="account-link" data-go="properties"><span><b>عقاراتي</b><small>العقارات المحفوظة لإعادة الطلب بسرعة</small></span><span>›</span></button>
      <button class="account-link" data-go="documents"><span><b>المستندات</b><small>كل المستندات النهائية</small></span><span>›</span></button>
      <button class="account-link" data-go="notifications"><span><b>الإشعارات</b><small>تحديثات الطلبات والتنبيهات</small></span><span>›</span></button>
    </section>`:''}

    ${isAgent?`<section class="card">
      <h3>التحقق</h3>
      <div class="accountfacts">
        <div><small>حالة الحساب</small><b>${agent?.verification_status==='approved'?'معتمد':agent?.verification_status==='pending'?'قيد المراجعة':agent?.verification_status==='suspended'?'موقوف':'غير معتمد'}</b></div>
        <div><small>طلبات مكتملة</small><b>${agent?.completed_orders||0}</b></div>
        <div><small>التقييم</small><b>${agent?.rating??'—'}</b></div>
      </div>
    </section>

    <section class="card">
      <h3>مناطق العمل</h3>
      <small class="accountmuted">${coverage.map(x=>esc(x.governorate)+(x.district?' / '+esc(x.district):'')).join('، ')||'لا توجد مناطق عمل.'}</small>
      <form id="coverage" class="coverage-account">
        <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${x}</option>`).join('')}</select>
        <input name="district" placeholder="القضاء (اختياري)">
        <button class="secondary full">تحديث منطقة العمل</button>
      </form>
    </section>

    <section class="card">
      <h3>الحساب البنكي</h3>
      <form id="payoutAccountForm">
        <label>اسم صاحب الحساب<input name="account_holder" required value="${esc(payout?.account_holder||profile?.full_name||'')}"></label>
        <label>اسم البنك<input name="bank_name" value="${esc(payout?.bank_name||'')}"></label>
        <label>IBAN<input name="iban" required autocomplete="off" value="${esc(payout?.iban||'')}"></label>
        ${payout?`<small class="accountmuted">${payout.is_verified?'تم التحقق من الحساب':'سيحتاج أي تعديل إلى مراجعة الإدارة.'}</small>`:''}
        <button class="primary full">حفظ بيانات التحويل</button>
      </form>
    </section>

    <section class="card account-links">
      <button class="account-link" data-go="agent-earnings"><span><b>الأرباح والدفعات</b><small>الحركات والرصيد والدفعات</small></span><span>›</span></button>
      <button class="account-link" data-go="notifications"><span><b>الإشعارات</b><small>طلبات جديدة وتحديثات الحساب</small></span><span>›</span></button>
    </section>`:''}

    <section class="card">
      <h3>الأمان</h3>
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
  return shell(renderNewOrder({services,bundleItems,serviceRequirements,savedProperties:customerProperties,savedAddresses:customerAddresses,deliveryConfig,profile,gov,esc,money}));
}
async function orders(){
  clearLive();
  const {data,error}=await supabase.from('orders').select('*').eq('customer_id',session.user.id).order('created_at',{ascending:false});
  if(error)return toast(error.message,true);
  app.innerHTML=shell(`<section class="role-dashboard">
    ${customerNav('orders')}
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
  const finalDocs=(d||[]).filter(x=>x.kind==='final_document');
  const payment=payments?.[0];
  const paymentMethodLabel=payment?.provider==='cash'?'نقداً':payment?.provider==='whish'?'Whish Pay':payment?.provider||'';
  const paymentLabel=o.refund_pending?'رد المبلغ قيد المعالجة':
    payment?.status==='paid'?`مدفوع${paymentMethodLabel?' • '+paymentMethodLabel:''}`:
    payment?.status==='refunded'?'تم رد المبلغ':
    payment?.status==='failed'?'فشل الدفع':
    o.assigned_agent_id?'الدفع مستحق الآن':'الدفع غير مستحق بعد';

  const customerAction=incompleteRequired.length
    ?{kind:'action',title:'مطلوب منك الآن',text:`أكمل ${incompleteRequired.length} عنصر مطلوب ليتم إرسال الطلب للوكلاء.`}
    :o.customer_submission_ready===false
      ?{kind:'action',title:'الطلب جاهز للإرسال',text:'راجع البيانات ثم أرسل الطلب للوكلاء.'}
    :o.refund_pending
      ?{kind:'waiting',title:'رد المبلغ قيد المعالجة',text:'لا يلزمك أي إجراء حالياً.'}
      :o.status==='submitted'&&!o.assigned_agent_id
        ?{kind:'waiting',title:'بانتظار قبول وكيل',text:'طلبك جاهز ويظهر للوكلاء المؤهلين.'}
        :o.status==='accepted'&&payment?.status!=='paid'
          ?{kind:'waiting',title:'الوكيل يعمل على طلبك',text:'الدفع نقداً للوكيل عند انتهاء العمل وقبل استلام المستندات.'}
          :o.status==='accepted'
            ?{kind:'ok',title:'تم تعيين وكيل',text:'تم تأكيد الدفع.'}
          :o.status==='completed'
            ?{kind:'ok',title:'اكتمل الطلب',text:finalDocs.length?'مستنداتك النهائية جاهزة للعرض والتنزيل.':'تم إكمال الطلب.'}
            :o.status==='cancelled'
              ?{kind:'waiting',title:'الطلب ملغى',text:o.refund_pending?'رد المبلغ قيد المعالجة.':'لا يوجد إجراء مطلوب.'}
              :{kind:'waiting',title:labels[o.status]||o.status,text:'لا يلزمك أي إجراء حالياً.'};

  app.innerHTML=shell(`<section class="order-detail">
    <div class="title"><div><small>الطلب</small><h2>${o.public_code}</h2></div><button data-go="orders">رجوع</button></div>

    <div class="next-step-card ${customerAction.kind}">
      <small>الخطوة الحالية</small>
      <b>${esc(customerAction.title)}</b>
      <span>${esc(customerAction.text)}</span>
    </div>

    <div class="order-status-card">
      <div><small>الحالة</small><b>${labels[o.status]||o.status}</b></div>
      ${o.expected_ready_at&&o.status!=='completed'? `<div><small>التاريخ المتوقع</small><b>${new Date(o.expected_ready_at).toLocaleDateString('ar-LB')}</b></div>`:''}
      <div><small>الإجمالي</small><b>${money(o.total_amount)}</b>${o.delivery_fee>0?`<small>يشمل ${money(o.delivery_fee)} توصيل</small>`:''}</div>
    </div>

    <section class="dashboard-panel">
      <div class="order-core-grid">
        <div><small>العقار</small><b>${esc(o.cadastral_area)} • ${esc(o.property_number)}</b></div>
        <div><small>الخدمة</small><b>${(i||[]).map(x=>esc(x.service_name_ar)).join('، ')}</b></div>
        <div><small>الاستلام</small><b>${o.delivery_mode==='hard_copy'?'نسخة ورقية + إلكترونية':'نسخة إلكترونية'}</b></div>
        ${o.delivery_mode==='hard_copy'?`<div><small>عنوان التوصيل</small><b>${esc([o.delivery_address_line1,o.delivery_address_line2,o.delivery_city,o.delivery_region].filter(Boolean).join(' • '))}</b></div>`:''}
      </div>
      ${(deliverables||[]).length?`<div class="deliverables compact"><small>المستندات المطلوبة</small><div>${deliverables.map(x=>`<span>${esc(x.service_name_ar)}</span>`).join('')}</div></div>`:''}
    </section>

    ${payment?`<div class="paymentbox">
      <div><small>الدفع</small><b>${paymentLabel}</b>${payment?.status==='paid'&&paymentMethodLabel?`<small>طريقة الدفع: ${esc(paymentMethodLabel)}</small>`:''}${payment?.status==='pending'&&!o.assigned_agent_id?'<small>لن يُطلب منك الدفع قبل قبول وكيل.</small>':''}${payment?.status!=='paid'&&o.assigned_agent_id?'<small>الدفع نقداً للوكيل عند انتهاء العمل. لا تعطِ رمز الدفع قبل تسليم المبلغ.</small>':''}</div>
      <strong>${money(payment?.amount??o.total_amount)}</strong>
    </div>`:''}

    ${payment?.status!=='paid'&&o.assigned_agent_id?`<div class="completebox">
      <span class="completecheck">$</span>
      <div><b>رمز الدفع النقدي</b><small>عندما يخبرك الوكيل أن الطلب جاهز، ادفع المبلغ ثم أعطه الرمز.</small><div data-cash-pin-result></div></div>
      <button class="secondary compact" data-generate-cash-pin="${o.id}">إظهار الرمز</button>
    </div>`:''}

    ${incompleteRequired.length?`<div class="completebox requirementgate">
      <span class="completecheck">!</span>
      <div><b>أكمل المعلومات المطلوبة</b><small>باقي ${incompleteRequired.length} عنصر مطلوب قبل إرسال الطلب للوكلاء.</small></div>
    </div>`:''}

    ${!incompleteRequired.length&&o.status==='submitted'&&!o.assigned_agent_id&&o.customer_submission_ready===false
      ?`<button class="primary full" data-finalize-order="${o.id}">إرسال الطلب للوكلاء</button>`
      :''}

    ${finalDocs.length?`<section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>المستندات</h3><small>${finalDocs.length}</small></div>
      <div class="document-list">
        ${finalDocs.map(x=>`<div class="document-row">
          <div><b>${esc(x.original_name||'مستند')}</b><small>${esc(x.mime_type||'')}</small></div>
          <div class="document-actions">
            <button class="secondary compact" data-file-view="${esc(x.storage_path)}" data-file-name="${esc(x.original_name||'مستند')}" data-file-mime="${esc(x.mime_type||'')}">عرض</button>
            <button class="secondary compact" data-file-download="${esc(x.storage_path)}">تنزيل</button>
          </div>
        </div>`).join('')}
      </div>
    </section>`:''}

    ${(reqs||[]).length?`<details class="order-section" ${incompleteRequired.length?'open':''}>
      <summary>بيانات ومتطلبات الطلب</summary>
      <div class="order-section-body">${renderRequirements(reqs||[])}</div>
    </details>`:''}

    <details class="order-section">
      <summary>التتبّع</summary>
      <div class="order-section-body timeline">${(e||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>
    </details>

    ${o.status==='completed'?`<details class="order-section">
      <summary>التقييم</summary>
      <div class="order-section-body">
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
      </div>
    </details>`:''}

    ${o.status!=='cancelled'?`<details class="order-section">
      <summary>الدعم</summary>
      <div class="order-section-body">
        ${feedback?.dispute&&['open','reviewing'].includes(feedback.dispute.status)
          ?`<div class="feedbackdone"><b>${feedback.dispute.status==='reviewing'?'طلب الدعم قيد المراجعة':'طلب الدعم مفتوح'}</b><small>${esc(feedback.dispute.reason)}</small></div>`
          :`${feedback?.dispute?.resolution?`<div class="feedbackdone"><b>رد الإدارة</b><small>${esc(feedback.dispute.resolution)}</small></div>`:''}
            <form id="supportForm" data-order-id="${o.id}" class="feedbackform">
              <textarea name="reason" required minlength="3" placeholder="اشرح المشكلة باختصار"></textarea>
              <button class="secondary full">طلب دعم</button>
            </form>`}
      </div>
    </details>`:''}

    ${o.status==='submitted'?`<button class="danger full" data-cancel="${o.id}">إلغاء الطلب</button>`:''}
  </section>`);

  bind();
  bindRequirementActions({toast,busy,reload:customerDetail});

  liveChannel=supabase.channel('customer-order-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>customerDetail(id))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`id=eq.${id}`},()=>customerDetail(id))
    .on('postgres_changes',{event:'*',schema:'public',table:'payments',filter:`order_id=eq.${id}`},()=>customerDetail(id))
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
  const mineIds=(mine||[]).map(o=>o.id);

  let workflowRows=[],deliverableRows=[],finalDocRows=[],agentPaymentRows=[];
  if(mineIds.length){
    const [w,dv,fd,p]=await Promise.all([
      supabase.from('order_workflow_steps').select('*').in('order_id',mineIds).order('sort_order'),
      supabase.from('order_deliverables').select('id,order_id').in('order_id',mineIds),
      supabase.from('documents').select('id,order_id,deliverable_id,kind').in('order_id',mineIds).eq('kind','final_document'),
      supabase.from('payments').select('order_id,status,created_at').in('order_id',mineIds).order('created_at',{ascending:false})
    ]);
    if(w.error)return toast(w.error.message,true);
    if(dv.error)return toast(dv.error.message,true);
    if(fd.error)return toast(fd.error.message,true);
    if(p.error)return toast(p.error.message,true);
    workflowRows=w.data||[];deliverableRows=dv.data||[];finalDocRows=fd.data||[];agentPaymentRows=p.data||[];
  }
  const agentPaymentByOrder={};
  for(const p of agentPaymentRows){if(!agentPaymentByOrder[p.order_id])agentPaymentByOrder[p.order_id]=p;}

  const nextByOrder={};
  for(const o of mine||[]){
    const wf=workflowRows.filter(x=>x.order_id===o.id);
    const nextStep=wf.find(x=>!x.completed_at);
    const dels=deliverableRows.filter(x=>x.order_id===o.id);
    const doneIds=new Set(finalDocRows.filter(x=>x.order_id===o.id).map(x=>x.deliverable_id));
    const missing=dels.filter(x=>!doneIds.has(x.id)).length;
    const paymentPending=paymentsEnabled&&Number(o.total_amount||0)>0&&agentPaymentByOrder[o.id]?.status!=='paid';
    nextByOrder[o.id]=nextStep
      ?{title:'الخطوة التالية',text:nextStep.label_ar,kind:'action'}
      :missing
        ?{title:'مطلوب منك',text:`ارفع ${missing} مستند نهائي`,kind:'action'}
        :paymentPending
          ?{title:'تحصيل الدفع النقدي',text:'استلم المبلغ ثم أدخل رمز العميل',kind:'action'}
          :o.delivery_mode==='hard_copy'&&!o.hard_copy_delivered_at
            ?{title:'مطلوب منك',text:'توصيل النسخة الورقية للعميل',kind:'action'}
            :{title:'الخطوة التالية',text:'إكمال الطلب',kind:'action'};
  }

  app.innerHTML=shell(`<section class="role-dashboard">
    ${agentNav('home')}
    <div class="role-dashboard-bar">
      <div><small>حساب الوكيل</small><h2>${esc(profile?.full_name||session?.user?.email||'')}</h2></div>
      <div class="agentbar-actions">
        <label class="availability"><input id="agentAvailable" type="checkbox" ${a.available?'checked':''}><span>${a.available?'متاح':'غير متاح'}</span></label>
        <button class="ghost" data-agent-logout>تسجيل الخروج</button>
      </div>
    </div>

    <div class="role-metrics">
      <div><small>طلبات حالية</small><b>${(mine||[]).length}</b></div>
      <div><small>طلبات متاحة</small><b>${(available||[]).length}</b></div>
      <div><small>الرصيد المتاح</small><b>${money(bal.available)}</b></div>
    </div>

    ${(mine||[]).length?`<section class="dashboard-panel attention-panel">
      <div class="dashboard-panel-head"><h3>مطلوب منك</h3></div>
      <div class="stack">
        ${(mine||[]).map(o=>{const a=nextByOrder[o.id];return `<button class="action-row" data-agent-order="${o.id}">
          <span><b>${o.public_code}</b><small>${esc(a?.text||labels[o.status]||o.status)}</small></span>
          <strong>فتح</strong>
        </button>`}).join('')}
      </div>
    </section>`:''}

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>طلباتي الحالية</h3></div>
      <div class="stack">${(mine||[]).map(o=>{const a=nextByOrder[o.id];return `<button class="order-dashboard-row" data-agent-order="${o.id}">
        <span class="order-dashboard-main"><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span>
        <span class="order-dashboard-state ${a?.kind||'action'}"><b>${a?.title||labels[o.status]||o.status}</b><small>${esc(a?.text||'')}</small></span>
      </button>`}).join('')||'<div class="empty">لا يوجد طلبات حالية.</div>'}</div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>طلبات متاحة</h3></div>
      <div class="stack">${(available||[]).slice(0,8).map(o=>`<div class="job">
        <span><b>${esc(o.service_names)}</b><small>${esc(o.governorate)} • ${esc(o.cadastral_area)}${o.delivery_mode==='hard_copy'?' • توصيل نسخة ورقية':''}</small></span>
        <strong>${money(o.agent_payout)}</strong>
        <button class="primary" data-accept="${o.id}">قبول</button>
      </div>`).join('')||'<div class="empty">لا يوجد طلبات متاحة حالياً.</div>'}</div>
    </section>

    <details class="dashboard-secondary">
      <summary>السجل والدفعات</summary>
      <div class="role-metrics compact">
        <div><small>مكتملة</small><b>${(completed||[]).length}</b></div>
        <div><small>قيد التنفيذ</small><b>${money(bal.pending)}</b></div>
        <div><small>مدفوع</small><b>${money(bal.paid)}</b></div>
      </div>
      <div class="stack">${(completed||[]).slice(0,5).map(o=>`<button class="row" data-agent-order="${o.id}">
        <span><b>${o.public_code}</b><small>${esc(o.cadastral_area)} • ${esc(o.property_number)}</small></span><i>مكتمل</i>
      </button>`).join('')}</div>
    </details>
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-feed-'+session.user.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'dispatch_offers',filter:`agent_id=eq.${session.user.id}`},()=>{
      toast('طلب جديد متاح');agentPortal();
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`assigned_agent_id=eq.${session.user.id}`},()=>agentPortal())
    .on('postgres_changes',{event:'*',schema:'public',table:'order_workflow_steps'},payload=>{
      if(mineIds.includes(payload.new?.order_id||payload.old?.order_id))agentPortal();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'payments'},payload=>{
      if(mineIds.includes(payload.new?.order_id||payload.old?.order_id))agentPortal();
    })
    .subscribe();
}
async function agentJob(id){
  clearLive();
  const [{data:rows,error},{data:events},{data:docs},{data:deliverables},{data:workflow},{data:requirements},{data:deliveryOrder},{data:feedback},{data:payments}]=await Promise.all([
    supabase.rpc('get_agent_job',{p_order_id:id}),
    supabase.from('order_events').select('*').eq('order_id',id).order('created_at'),
    supabase.from('documents').select('*').eq('order_id',id).order('created_at'),
    supabase.from('order_deliverables').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('order_workflow_steps').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('order_requirements').select('*').eq('order_id',id).order('created_at'),
    supabase.from('orders').select('delivery_mode,delivery_address_line1,delivery_address_line2,delivery_city,delivery_region,delivery_postal_code,delivery_country,delivery_fee,delivery_agent_payout,hard_copy_delivered_at,total_amount').eq('id',id).single(),
    supabase.rpc('get_order_feedback',{p_order_id:id}),
    supabase.from('payments').select('status,provider,amount,paid_at').eq('order_id',id).order('created_at',{ascending:false}).limit(1)
  ]);
  const o=rows?.[0];
  if(error||!o)return toast(error?.message||'تعذر فتح الطلب',true);
  const payment=payments?.[0];
  const paymentPending=paymentsEnabled&&Number(deliveryOrder?.total_amount||0)>0&&payment?.status!=='paid';
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
  const hardCopyPending=deliveryOrder?.delivery_mode==='hard_copy'&&!deliveryOrder?.hard_copy_delivered_at;
  const readyForCash=!!next&&next[0]==='completed'&&!missingDeliverables.length;
  const agentAction=!next
      ?{kind:'ok',title:'تم إكمال الطلب',text:'لا يوجد إجراء مطلوب.'}
    :next[0]==='completed'&&missingDeliverables.length
      ?{kind:'action',title:'مطلوب منك الآن',text:`ارفع ${missingDeliverables.length} مستند نهائي قبل إكمال الطلب.`}
      :readyForCash&&paymentPending
        ?{kind:'action',title:'تحصيل الدفع النقدي',text:'استلم المبلغ من العميل ثم أدخل رمز الدفع الذي يظهر لديه.'}
      :next[0]==='completed'&&hardCopyPending
        ?{kind:'action',title:'مطلوب منك الآن',text:'بعد تأكيد الدفع، سلّم النسخة الورقية ثم أكّد التوصيل.'}
        :{kind:'action',title:'الخطوة التالية',text:next[1]};

  app.innerHTML=shell(`<section class="card order-workspace">
    <div class="title"><h2>${o.public_code}</h2><button data-go="agent">رجوع</button></div>

    <div class="next-step-card ${agentAction.kind}">
      <small>العمل الحالي</small>
      <b>${esc(agentAction.title)}</b>
      <span>${esc(agentAction.text)}</span>
    </div>

    <div class="jobinfo">
      <div><small>الدفع</small><b>${payment?.status==='paid'?'تم الدفع':'نقداً عند الانتهاء'}</b></div>
      <div><small>الخدمة</small><b>${esc(o.service_names)}</b></div>
      <div><small>العقار</small><b>${esc(o.cadastral_area)} • ${esc(o.property_number)}</b></div>
      <div><small>بدلك</small><b>${money(o.agent_payout)}</b>${deliveryOrder?.delivery_agent_payout>0?`<small>يشمل ${money(deliveryOrder.delivery_agent_payout)} توصيل</small>`:''}</div>
      <div><small>الاستلام</small><b>${deliveryOrder?.delivery_mode==='hard_copy'?'نسخة ورقية + إلكترونية':'نسخة إلكترونية'}</b></div>
      <div><small>العميل</small><b>${esc(o.customer_name||'—')}</b></div>
      <div><small>الهاتف</small><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone||'—')}</a></div>
      ${o.expected_ready_at?`<div><small>الوقت المتوقع</small><b>${new Date(o.expected_ready_at).toLocaleDateString('ar-LB')}</b></div>`:''}
      ${o.notes?`<div class="wide"><small>ملاحظة</small><b>${esc(o.notes)}</b></div>`:''}
    </div>

    ${deliveryOrder?.delivery_mode==='hard_copy'?`<section class="delivery-task ${deliveryOrder.hard_copy_delivered_at?'done':''}">
      <div>
        <small>توصيل النسخة الورقية</small>
        <b>${deliveryOrder.hard_copy_delivered_at?'تم التوصيل':'مطلوب التوصيل'}</b>
        <span>${esc([deliveryOrder.delivery_address_line1,deliveryOrder.delivery_address_line2,deliveryOrder.delivery_city,deliveryOrder.delivery_region,deliveryOrder.delivery_country].filter(Boolean).join(' • '))}</span>
      </div>
      ${deliveryOrder.hard_copy_delivered_at?'<span class="verifiedmark">✓</span>':`<button class="primary compact" data-confirm-hard-copy="${o.id}">تأكيد التوصيل</button>`}
    </section>`:''}

    ${(requirements||[]).length?`<h3>معلومات العميل</h3>
      <div class="requirements agentrequirements">
        ${(requirements||[]).map(r=>{
          const d=r.document_id?docById[r.document_id]:null;
          return `<div class="requirement done">
            <div><b>${esc(r.label_ar)}</b><small>${r.value_text?esc(r.value_text):(d?esc(d.original_name||'مرفق'):(r.required?'مطلوب':'لم يقدّم'))}</small></div>
            ${d?`<button class="secondary compact" data-file-view="${esc(d.storage_path)}" data-file-name="${esc(d.original_name||'مستند')}" data-file-mime="${esc(d.mime_type||'')}">عرض</button>`:'<span class="reqdone">✓</span>'}
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
              ${d?`<button class="secondary compact" data-file-view="${esc(d.storage_path)}" data-file-name="${esc(d.original_name||'مستند')}" data-file-mime="${esc(d.mime_type||'')}">عرض</button>`:''}
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

    ${readyForCash&&paymentPending?`<section class="completebox"><span class="completecheck">$</span><div><b>استلام الدفع النقدي</b><small>استلم ${money(payment?.amount??deliveryOrder?.total_amount)} ثم أدخل رمز العميل المكوّن من 6 أرقام.</small></div><form id="cashPinForm" data-order-id="${o.id}" style="display:flex;gap:8px;align-items:center"><input name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"><button class="primary compact">تأكيد الدفع</button></form></section>`:''}

    <h3>التتبّع</h3>
    <div class="timeline">${(events||[]).map(x=>`<div><b>${esc(x.label_ar)}</b><small>${new Date(x.created_at).toLocaleString('ar-LB')}</small></div>`).join('')}</div>

    <details class="order-section">
      <summary>الدعم</summary>
      <div class="order-section-body">
        ${feedback?.dispute&&['open','reviewing'].includes(feedback.dispute.status)
          ?`<div class="feedbackdone"><b>${feedback.dispute.status==='reviewing'?'طلب الدعم قيد المراجعة':'طلب الدعم مفتوح'}</b><small>${esc(feedback.dispute.reason)}</small></div>`
          :`${feedback?.dispute?.resolution?`<div class="feedbackdone"><b>رد الإدارة</b><small>${esc(feedback.dispute.resolution)}</small></div>`:''}
            <form id="supportForm" data-order-id="${o.id}" class="feedbackform">
              <textarea name="reason" required minlength="3" placeholder="اشرح المشكلة باختصار"></textarea>
              <button class="secondary full">طلب دعم</button>
            </form>`}
      </div>
    </details>

    ${next?`
      ${next[0]==='completed'&&missingDeliverables.length?`<div class="completebox requirementgate"><span class="completecheck">!</span><div><b>أكمل المستندات النهائية</b><small>باقي ${missingDeliverables.length} مستند قبل إكمال الطلب.</small></div></div>`:''}
      <button class="primary full next-action" data-status="${next[0]}" data-id="${o.id}" ${next[0]==='completed'&&(missingDeliverables.length||hardCopyPending||paymentPending)?'disabled':''}>${next[0]==='completed'&&paymentPending?'بانتظار الدفع النقدي':next[1]}</button>
    `:'<div class="donebox">تم إكمال الطلب</div>'}
  </section>`);
  bind();

  liveChannel=supabase.channel('agent-job-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_events',filter:`order_id=eq.${id}`},()=>agentJob(id))
    .on('postgres_changes',{event:'*',schema:'public',table:'payments',filter:`order_id=eq.${id}`},()=>agentJob(id))
    .subscribe();
}
async function adminAccess(){
  clearLive();
  if(profile?.role==='admin'){
    go('admin');
    return;
  }

  app.innerHTML=shell(`<section class="card narrow adminlogin">
    <div class="title"><h2>دخول الإدارة</h2><button data-go="home">رجوع</button></div>
    <form id="adminLogin">
      <input name="email" type="email" autocomplete="username" required placeholder="البريد الإلكتروني" value="bachir.ban@gmail.com">
      <input name="password" type="password" autocomplete="current-password" required placeholder="كلمة المرور">
      <button class="primary full">دخول</button>
    </form>
  </section>`);
  bind();
}

async function admin(section='overview'){
  clearLive();
  if(profile?.role!=='admin')return go('home');

  const allowed=new Set(['overview','orders','agents','services','support']);
  if(!allowed.has(section))section='overview';

  const [{data:a},{data:srv},{data:o},{data:reqs},{data:disputes},{data:workflow},{data:bundles},{data:incompleteReqs},{data:failedPayments}]=await Promise.all([
    supabase.from('agent_profiles').select('*').order('created_at',{ascending:false}),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(50),
    supabase.from('service_requirements').select('*').order('sort_order'),
    supabase.from('disputes').select('*').in('status',['open','reviewing']).order('created_at',{ascending:false}).limit(50),
    supabase.from('service_workflow_steps').select('*').order('sort_order'),
    supabase.from('service_bundle_items').select('*').order('sort_order'),
    supabase.from('order_requirements').select('order_id').eq('required',true).is('completed_at',null),
    supabase.from('payments').select('order_id,status').eq('status','failed')
  ]);

  const ids=(a||[]).map(x=>x.user_id),names={};
  if(ids.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',ids);
    (p||[]).forEach(x=>names[x.id]=x);
  }

  const activeOrders=(o||[]).filter(x=>!['completed','cancelled'].includes(x.status)).length;
  const pendingAgents=(a||[]).filter(x=>x.verification_status==='pending').length;
  const activeServices=(srv||[]).filter(x=>x.active).length;
  const openSupport=(disputes||[]).length;
  const incompleteOrderIds=new Set((incompleteReqs||[]).map(x=>x.order_id));
  const refundOrders=(o||[]).filter(x=>x.refund_pending);
  const readyUnassigned=(o||[]).filter(x=>
    x.status==='submitted'&&!x.assigned_agent_id&&x.customer_submission_ready!==false&&!incompleteOrderIds.has(x.id)
  );
  const waitingCustomer=(o||[]).filter(x=>
    !['completed','cancelled'].includes(x.status)
    && (incompleteOrderIds.has(x.id)||x.customer_submission_ready===false)
  );
  const failedPaymentOrders=new Set((failedPayments||[]).map(x=>x.order_id));
  const adminAttention=pendingAgents+openSupport+refundOrders.length+readyUnassigned.length+(paymentsEnabled?failedPaymentOrders.size:0);

  const nav=`<div class="adminnav">
    <button class="${section==='overview'?'active':''}" data-go="admin">الرئيسية</button>
    <button class="${section==='orders'?'active':''}" data-go="admin/orders">الطلبات</button>
    <button class="${section==='agents'?'active':''}" data-go="admin/agents">الوكلاء</button>
    <button class="${section==='services'?'active':''}" data-go="admin/services">الخدمات</button>
    <button class="${section==='support'?'active':''}" data-go="admin/support">الدعم</button>
  </div>`;

  let body='';

  if(section==='overview'){
    body=`
      <div class="adminmetrics">
        <button data-go="admin/orders"><small>طلبات جارية</small><b>${activeOrders}</b></button>
        <button data-go="admin/agents"><small>وكلاء للمراجعة</small><b>${pendingAgents}</b></button>
        <button data-go="admin/support"><small>دعم مفتوح</small><b>${openSupport}</b></button>
        <button><small>بحاجة لتدخل</small><b>${adminAttention}</b></button>
      </div>

      ${adminAttention?`<section class="adminpanel attention-panel">
        <div class="adminsectionhead"><h3>بحاجة لتدخل</h3><small>${adminAttention}</small></div>
        <div class="stack">
          ${pendingAgents?`<button class="action-row" data-go="admin/agents"><span><b>مراجعة الوكلاء</b><small>${pendingAgents} حساب بانتظار المراجعة</small></span><strong>فتح</strong></button>`:''}
          ${openSupport?`<button class="action-row" data-go="admin/support"><span><b>طلبات الدعم</b><small>${openSupport} طلب مفتوح</small></span><strong>فتح</strong></button>`:''}
          ${refundOrders.map(x=>`<button class="action-row" data-admin-order="${x.id}"><span><b>${x.public_code}</b><small>رد مبلغ بانتظار المعالجة</small></span><strong>فتح</strong></button>`).join('')}
          ${readyUnassigned.map(x=>`<button class="action-row" data-admin-order="${x.id}"><span><b>${x.public_code}</b><small>جاهز للوكلاء ولم يتم تعيين وكيل بعد</small></span><strong>فتح</strong></button>`).join('')}
          ${paymentsEnabled?(o||[]).filter(x=>failedPaymentOrders.has(x.id)).map(x=>`<button class="action-row" data-admin-order="${x.id}"><span><b>${x.public_code}</b><small>فشل الدفع</small></span><strong>فتح</strong></button>`).join(''):''}
        </div>
      </section>`:''}

      ${waitingCustomer.length?`<section class="adminpanel">
        <div class="adminsectionhead"><h3>بانتظار العميل</h3><small>${waitingCustomer.length}</small></div>
        <div class="stack">
          ${waitingCustomer.slice(0,8).map(x=>`<button class="row" data-admin-order="${x.id}">
            <span><b>${x.public_code}</b><small>معلومات مطلوبة غير مكتملة</small></span><i>بانتظار العميل</i>
          </button>`).join('')}
        </div>
      </section>`:''}

      <section class="adminpanel">
        <div class="adminsectionhead"><h3>آخر الطلبات</h3><button data-go="admin/orders">عرض الكل</button></div>
        <div class="stack">${(o||[]).slice(0,6).map(x=>`<button class="row" data-admin-order="${x.id}">
          <span><b>${x.public_code}</b><small>${esc(x.cadastral_area)} • ${esc(x.property_number)}</small></span>
          <i>${labels[x.status]||x.status}</i>
        </button>`).join('')||'<div class="empty">لا توجد طلبات.</div>'}</div>
      </section>`;
  }

  if(section==='orders'){
    body=`<section class="adminpanel">
      <div class="adminsectionhead"><h3>الطلبات</h3><small>${(o||[]).length} طلب</small></div>
      <div class="stack">${(o||[]).map(x=>`<button class="row" data-admin-order="${x.id}">
        <span><b>${x.public_code}</b><small>${esc(x.cadastral_area)} • ${esc(x.property_number)}</small></span>
        <i>${labels[x.status]||x.status}</i>
      </button>`).join('')||'<div class="empty">لا توجد طلبات.</div>'}</div>
    </section>`;
  }

  if(section==='agents'){
    body=`<section class="adminpanel">
      <div class="adminsectionhead"><h3>الوكلاء</h3><small>${(a||[]).length} وكيل</small></div>
      <div class="stack">${(a||[]).map(x=>`<button class="row" data-admin-agent="${x.user_id}">
        <span><b>${esc(names[x.user_id]?.full_name||names[x.user_id]?.email||x.user_id)}</b><small>${esc(names[x.user_id]?.phone||'')}</small></span>
        <i>${x.verification_status==='approved'?'معتمد':x.verification_status==='pending'?'قيد المراجعة':x.verification_status==='suspended'?'موقوف':'مرفوض'}</i>
      </button>`).join('')||'<div class="empty">لا يوجد وكلاء.</div>'}</div>
    </section>`;
  }

  if(section==='services'){
    body=`<section class="adminpanel">
      <div class="adminsectionhead"><h3>توصيل النسخ الورقية</h3><small>إعدادات عامة</small></div>
      <form id="deliveryConfigForm" class="inline-editor">
        <label class="checkline"><input type="checkbox" name="enabled" ${deliveryConfig?.enabled?'checked':''}> تفعيل التوصيل الورقي</label>
        <div class="grid">
          <label>رسوم العميل<input name="customer_fee" type="number" min="0" step="0.01" value="${Number(deliveryConfig?.customer_fee||0)}"></label>
          <label>بدل الوكيل<input name="agent_payout" type="number" min="0" step="0.01" value="${Number(deliveryConfig?.agent_payout||0)}"></label>
        </div>
        <button class="primary">حفظ إعدادات التوصيل</button>
      </form>
    </section>
    <section class="adminpanel">
      <div class="adminsectionhead"><h3>الخدمات</h3><small>التسعير والمتطلبات ومراحل التنفيذ</small></div>
      <div class="stack">${renderServicesAdmin(srv||[],reqs||[],workflow||[],bundles||[])}</div>
    </section>`;
  }

  if(section==='support'){
    body=`<section class="adminpanel">
      <div class="adminsectionhead"><h3>الدعم</h3><small>${openSupport} مفتوح</small></div>
      <div class="stack">${(disputes||[]).map(d=>`<button class="row" data-admin-dispute="${d.id}">
        <span><b>طلب دعم</b><small>${esc(d.reason)}</small></span>
        <i>${d.status==='reviewing'?'قيد المراجعة':'جديد'}</i>
      </button>`).join('')||'<div class="empty">لا توجد طلبات دعم مفتوحة.</div>'}</div>
    </section>`;
  }

  app.innerHTML=shell(`<section class="admindashboard">
    <div class="adminbar">
      <div><small>لوحة الإدارة</small><h2>عنّك</h2></div>
      <button class="ghost" data-account-logout>تسجيل الخروج</button>
    </div>
    ${nav}
    ${body}
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

  const [{data:a,error},{data:p},{data:coverage},{data:orders},{data:ledger},{data:reqs},{data:docs},{data:payouts},{data:payoutAccount}]=await Promise.all([
    supabase.from('agent_profiles').select('*').eq('user_id',id).single(),
    supabase.from('profiles').select('id,full_name,email,phone,is_active').eq('id',id).single(),
    supabase.from('agent_coverage').select('*').eq('agent_id',id).eq('active',true),
    supabase.from('orders').select('*').eq('assigned_agent_id',id).order('created_at',{ascending:false}).limit(30),
    supabase.from('agent_ledger').select('*').eq('agent_id',id).order('created_at',{ascending:false}).limit(100),
    supabase.from('agent_verification_requirements').select('*').eq('active',true).order('sort_order'),
    supabase.from('agent_documents').select('*').eq('agent_id',id),
    supabase.from('payouts').select('*').eq('agent_id',id).order('created_at',{ascending:false}).limit(20),
    supabase.from('agent_payout_accounts').select('*').eq('user_id',id).maybeSingle()
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

    <h3>الحساب البنكي والدفعات</h3>
    ${payoutAccount?`<div class="card payout-account-admin">
      <div class="jobinfo">
        <div><small>صاحب الحساب</small><b>${esc(payoutAccount.account_holder||'—')}</b></div>
        <div><small>البنك</small><b>${esc(payoutAccount.bank_name||'—')}</b></div>
        <div class="wide"><small>IBAN</small><b class="iban-value">${esc(payoutAccount.iban||'—')}</b></div>
        <div><small>التحقق</small><b>${payoutAccount.is_verified?'معتمد':'غير معتمد'}</b></div>
      </div>
      <div class="adminagentactions">
        <button class="${payoutAccount.is_verified?'secondary':'primary'}" data-payout-account-verify="${id}" data-verify-value="${payoutAccount.is_verified?'false':'true'}">
          ${payoutAccount.is_verified?'إلغاء اعتماد الحساب':'اعتماد الحساب البنكي'}
        </button>
        ${available>0?`<button class="primary" data-create-payout="${id}" ${payoutAccount.is_verified?'':'disabled'}>إنشاء دفعة ${money(available)}</button>`:''}
      </div>
    </div>`:`<div class="info-box"><b>لا يوجد حساب تحويل</b><small>يجب على الوكيل حفظ بيانات الحساب البنكي قبل إنشاء أي دفعة.</small></div>`}

    <div class="stack payout-list">
      ${(payouts||[]).map(x=>`<div class="adminrow">
        <span><b>${money(x.amount)} ${esc(x.currency||'USD')}</b><small>${x.status==='paid'?'مدفوع':x.status==='pending'?'بانتظار التحويل':x.status==='void'?'ملغى':esc(x.status)} • ${new Date(x.created_at).toLocaleDateString('ar-LB')}</small></span>
        <div class="row-actions">
          ${x.status==='pending'?`
            <button class="primary compact" data-payout-paid="${x.id}" data-agent-id="${id}">تسجيل دفعة نقدية</button>
            <button class="secondary compact" data-payout-cancel="${x.id}" data-agent-id="${id}">إلغاء الدفعة</button>
          `:''}
        </div>
      </div>`).join('')||'<div class="empty">لا توجد دفعات بعد.</div>'}
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

  const [
    {data:pack,error},
    {data:agents},
    {data:payments},
    {data:workflowSteps},
    {data:deliverables},
    {data:disputes},
    {data:assignmentHistory}
  ]=await Promise.all([
    supabase.rpc('admin_get_order',{p_order_id:id}),
    supabase.from('agent_profiles').select('user_id,verification_status,available').eq('verification_status','approved'),
    supabase.from('payments').select('*').eq('order_id',id).order('created_at',{ascending:false}).limit(1),
    supabase.from('order_workflow_steps').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('order_deliverables').select('*').eq('order_id',id).order('sort_order'),
    supabase.from('disputes').select('*').eq('order_id',id).order('created_at',{ascending:false}),
    supabase.from('order_assignment_history').select('*').eq('order_id',id).order('created_at',{ascending:false})
  ]);
  if(error||!pack)return toast(error?.message||'تعذر فتح الطلب',true);

  const o=pack.order,items=pack.items||[],events=pack.events||[],docs=pack.documents||[],reqs=pack.requirements||[];
  const allAgentIds=[...new Set([...(agents||[]).map(x=>x.user_id),o.assigned_agent_id,...(assignmentHistory||[]).flatMap(x=>[x.from_agent_id,x.to_agent_id])].filter(Boolean))];
  const agentNames={};
  if(allAgentIds.length){
    const {data:p}=await supabase.from('profiles').select('id,full_name,email,phone').in('id',allAgentIds);
    (p||[]).forEach(x=>agentNames[x.id]=x);
  }

  const payment=payments?.[0];
  const docsById=Object.fromEntries(docs.map(d=>[d.id,d]));
  const finalByDeliverable=Object.fromEntries(docs.filter(d=>d.kind==='final_document'&&d.deliverable_id).map(d=>[d.deliverable_id,d]));
  const incompleteRequired=reqs.filter(r=>r.required&&!r.completed_at);
  const missingDeliverables=(deliverables||[]).filter(x=>!finalByDeliverable[x.id]);
  const currentWorkflow=(workflowSteps||[]).find(x=>!x.completed_at);
  const openSupport=(disputes||[]).find(x=>['open','reviewing'].includes(x.status));
  const currentAgent=agentNames[o.assigned_agent_id];

  const canAssign=!['completed','cancelled'].includes(o.status)
    && o.customer_submission_ready!==false
    && incompleteRequired.length===0;

  let eligibleAgents=agents||[];
  if(eligibleAgents.length){
    const ids=eligibleAgents.map(a=>a.user_id);
    const {data:coverageRows}=await supabase.from('agent_coverage')
      .select('agent_id,governorate,active')
      .in('agent_id',ids)
      .eq('active',true);
    const eligibleIds=new Set((coverageRows||[])
      .filter(x=>String(x.governorate||'').trim().toLowerCase()===String(o.governorate||'').trim().toLowerCase())
      .map(x=>x.agent_id));
    eligibleAgents=eligibleAgents.filter(a=>eligibleIds.has(a.user_id));
  }

  const paymentLabel=o.refund_pending?'رد المبلغ قيد المعالجة':
    payment?.status==='paid'?'مدفوع نقداً':
    payment?.status==='refunded'?'تم رد المبلغ':
    payment?.status==='failed'?'فشل الدفع':'بانتظار الدفع';

  const adminWarnings=[];
  if(incompleteRequired.length)adminWarnings.push(`العميل لم يكمل ${incompleteRequired.length} متطلب مطلوب`);
  if(o.customer_submission_ready===false&&!incompleteRequired.length)adminWarnings.push('العميل لم يرسل الطلب للوكلاء بعد');
  if(o.customer_submission_ready!==false&&!o.assigned_agent_id&&o.status==='submitted'&&!incompleteRequired.length)adminWarnings.push(
    eligibleAgents.length?'الطلب جاهز ولم يقبله أي وكيل بعد':'لا يوجد وكيل مؤهل في هذه المحافظة'
  );
  if(openSupport)adminWarnings.push('يوجد طلب دعم مفتوح');
  if(o.refund_pending)adminWarnings.push('رد المبلغ يحتاج متابعة');
  if(paymentsEnabled&&payment?.status==='failed')adminWarnings.push('فشل الدفع');
  if(o.status==='collected'&&missingDeliverables.length)adminWarnings.push(`ناقص ${missingDeliverables.length} مستند نهائي قبل الإكمال`);

  const nextAdminState=adminWarnings.length
    ?{kind:'action',title:'بحاجة لمتابعة',text:adminWarnings[0]}
    :o.status==='completed'
      ?{kind:'ok',title:'الطلب مكتمل',text:'لا يوجد إجراء تشغيلي مطلوب.'}
      :o.status==='cancelled'
        ?{kind:'waiting',title:'الطلب ملغى',text:o.refund_pending?'رد المبلغ ما زال قيد المعالجة.':'لا يوجد إجراء مطلوب.'}
        :currentWorkflow
          ?{kind:'waiting',title:'قيد التنفيذ',text:`الخطوة التالية للوكيل: ${currentWorkflow.label_ar}`}
          :{kind:'waiting',title:labels[o.status]||o.status,text:'لا يوجد تدخل إداري مطلوب حالياً.'};

  const propertyBits=[
    o.governorate,
    o.district,
    o.cadastral_area,
    o.property_number?`عقار ${o.property_number}`:'',
    o.property_section?`قسم/حصة ${o.property_section}`:''
  ].filter(Boolean).map(esc).join(' • ');

  app.innerHTML=shell(`<section class="admin-order-workspace">
    <div class="title">
      <div><small>إدارة الطلب</small><h2>${esc(o.public_code)}</h2></div>
      <button data-go="admin/orders">رجوع</button>
    </div>

    <div class="next-step-card ${nextAdminState.kind}">
      <small>الوضع التشغيلي</small>
      <b>${esc(nextAdminState.title)}</b>
      <span>${esc(nextAdminState.text)}</span>
    </div>

    ${adminWarnings.length?`<section class="dashboard-panel attention-panel">
      <div class="dashboard-panel-head"><h3>تنبيهات</h3><small>${adminWarnings.length}</small></div>
      <div class="admin-warning-list">
        ${adminWarnings.map(x=>`<div>• ${esc(x)}</div>`).join('')}
      </div>
    </section>`:''}

    <div class="admin-order-grid">
      <section class="dashboard-panel">
        <h3>العميل</h3>
        <div class="order-core-grid">
          <div><small>الاسم</small><b>${esc(o.customer_name||'—')}</b></div>
          <div><small>الهاتف</small><a href="tel:${esc(o.customer_phone||'')}">${esc(o.customer_phone||'—')}</a></div>
          <div><small>البريد</small><b>${esc(o.customer_email||'—')}</b></div>
        </div>
      </section>

      <section class="dashboard-panel">
        <h3>العقار</h3>
        <div class="order-core-grid">
          <div class="wide"><small>التفاصيل</small><b>${propertyBits||'—'}</b></div>
          ${o.notes?`<div class="wide"><small>ملاحظة العميل</small><b>${esc(o.notes)}</b></div>`:''}
        </div>
      </section>

      <section class="dashboard-panel">
        <h3>الخدمة والمبلغ</h3>
        <div class="order-core-grid">
          <div class="wide"><small>الخدمات</small><b>${items.map(x=>esc(x.service_name_ar)).join('، ')||'—'}</b></div>
          <div><small>سعر الخدمات</small><b>${money(o.services_total)}</b></div>
          <div><small>رسوم رسمية</small><b>${money(o.official_fees)}</b></div>
          ${Number(o.delivery_fee||0)>0?`<div><small>التوصيل</small><b>${money(o.delivery_fee)}</b></div>`:''}
          <div><small>الإجمالي</small><b>${money(o.total_amount)}</b></div>
        </div>
      </section>

      <section class="dashboard-panel">
        <h3>الوكيل</h3>
        ${o.assigned_agent_id?`<div class="agent-assigned-card">
          <div><b>${esc(currentAgent?.full_name||currentAgent?.email||o.assigned_agent_id)}</b><small>${esc(currentAgent?.phone||'')}</small></div>
          <button class="secondary compact" data-admin-agent="${o.assigned_agent_id}">فتح حساب الوكيل</button>
        </div>`:'<div class="empty">لم يتم تعيين وكيل بعد.</div>'}
      </section>
    </div>

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>الدفع</h3><b>${money(payment?.amount??o.total_amount)}</b></div>
      <div class="adminrow paymentadmin">
        <span><b>${paymentLabel}</b><small>${payment?.provider_reference?esc(payment.provider_reference):''}</small></span>
        <div class="paymentactions">
          ${payment&&o.assigned_agent_id&&['pending','failed'].includes(payment.status)?`<button class="secondary compact" data-mark-payment-paid="${payment.id}" data-order-id="${o.id}">تسجيل دفعة نقدية</button>`:''}
          ${payment&&payment.status==='paid'&&o.status==='cancelled'?`<button class="secondary compact" data-mark-payment-refunded="${payment.id}" data-order-id="${o.id}">تسجيل رد المبلغ</button>`:''}
        </div>
      </div>
    </section>

    ${openSupport?`<section class="dashboard-panel attention-panel">
      <div class="dashboard-panel-head"><h3>الدعم</h3><button class="secondary compact" data-admin-dispute="${openSupport.id}">فتح الحالة</button></div>
      <div class="feedbackdone">
        <b>${openSupport.status==='reviewing'?'قيد المراجعة':'طلب دعم مفتوح'}</b>
        <small>${esc(openSupport.reason)}</small>
      </div>
    </section>`:''}

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>المتطلبات</h3><small>${reqs.length-incompleteRequired.length}/${reqs.length}</small></div>
      <div class="stack">${reqs.length?reqs.map(r=>{
        const d=r.document_id?docsById[r.document_id]:null;
        return `<div class="adminrow">
          <span><b>${esc(r.label_ar)}</b><small>${r.value_text?esc(r.value_text):(d?esc(d.original_name||'مرفق'):(r.required?'مطلوب وغير مكتمل':'اختياري'))}</small></span>
          <div class="row-actions">
            ${d?`<button class="secondary compact" data-file-view="${esc(d.storage_path)}" data-file-name="${esc(d.original_name||'مستند')}" data-file-mime="${esc(d.mime_type||'')}">عرض</button>
            <button class="secondary compact" data-file-download="${esc(d.storage_path)}">تنزيل</button>`:''}
            <i>${r.completed_at?'مكتمل':'ناقص'}</i>
          </div>
        </div>`;
      }).join(''):'<div class="empty">لا توجد متطلبات.</div>'}</div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>التنفيذ</h3><small>${(workflowSteps||[]).filter(x=>x.completed_at).length}/${(workflowSteps||[]).length}</small></div>
      <div class="workflowchecklist">
        ${(workflowSteps||[]).map((x,idx)=>`<div class="workflowstep ${x.completed_at?'done':(!x.completed_at&&(workflowSteps||[]).findIndex(w=>!w.completed_at)===idx?'current':'')}">
          <span>${x.completed_at?'✓':(!x.completed_at&&(workflowSteps||[]).findIndex(w=>!w.completed_at)===idx?'•':'○')}</span>
          <div><b>${esc(x.label_ar)}</b>${x.completed_at?`<small>${new Date(x.completed_at).toLocaleString('ar-LB')}</small>`:''}</div>
        </div>`).join('')||'<div class="empty">لا توجد مراحل تنفيذ.</div>'}
      </div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-head"><h3>المستندات النهائية</h3><small>${(deliverables||[]).length-missingDeliverables.length}/${(deliverables||[]).length}</small></div>
      <div class="deliverychecklist">
        ${(deliverables||[]).map(x=>{
          const d=finalByDeliverable[x.id];
          return `<div class="deliveryitem ${d?'done':''}">
            <div class="deliverylabel"><span class="deliverystatus">${d?'✓':'○'}</span><span><b>${esc(x.service_name_ar)}</b><small>${d?esc(d.original_name||'تم رفع المستند النهائي'):'بانتظار المستند النهائي'}</small></span></div>
            ${d?`<div class="row-actions">
              <button class="secondary compact" data-file-view="${esc(d.storage_path)}" data-file-name="${esc(d.original_name||'مستند')}" data-file-mime="${esc(d.mime_type||'')}">عرض</button>
              <button class="secondary compact" data-file-download="${esc(d.storage_path)}">تنزيل</button>
            </div>`:''}
          </div>`;
        }).join('')||'<div class="empty">لا توجد مستندات مطلوبة.</div>'}
      </div>
    </section>

    ${docs.length?`<details class="order-section">
      <summary>كل ملفات الطلب (${docs.length})</summary>
      <div class="order-section-body stack">
        ${docs.map(d=>`<div class="adminrow">
          <span><b>${esc(d.original_name||'ملف')}</b><small>${d.kind==='customer_attachment'?'مرفق العميل':d.kind==='final_document'?'مستند نهائي':esc(d.kind)}</small></span>
          <div class="row-actions">
            <button class="secondary compact" data-file-view="${esc(d.storage_path)}" data-file-name="${esc(d.original_name||'مستند')}" data-file-mime="${esc(d.mime_type||'')}">عرض</button>
            <button class="secondary compact" data-file-download="${esc(d.storage_path)}">تنزيل</button>
          </div>
        </div>`).join('')}
      </div>
    </details>`:''}

    <details class="order-section" open>
      <summary>إدارة الطلب</summary>
      <div class="order-section-body admin-order-controls">
        <form id="adminStatusForm">
          <input type="hidden" name="status" value="${o.status}">
          <input name="note" required minlength="2" placeholder="إضافة ملاحظة على الطلب">
          <button class="secondary full">إضافة الملاحظة</button>
        </form>

        ${!['completed','cancelled'].includes(o.status)?`
          ${!canAssign?`<div class="info-box"><b>لا يمكن التعيين الآن</b><small>${incompleteRequired.length?'هناك متطلبات مطلوبة غير مكتملة.':'العميل لم يرسل الطلب للوكلاء بعد.'}</small></div>`:''}
          <form id="adminAssignForm">
            <select name="agent" required ${canAssign?'':'disabled'}>
              <option value="">${o.assigned_agent_id?'اختر وكيلاً لإعادة التعيين':'اختر وكيلاً للتعيين'}</option>
              ${eligibleAgents.filter(a=>a.user_id!==o.assigned_agent_id).map(a=>`<option value="${a.user_id}">${esc(agentNames[a.user_id]?.full_name||agentNames[a.user_id]?.email||a.user_id)}${a.available?' • متاح':' • غير متاح'}</option>`).join('')}
            </select>
            <input name="reason" ${o.assigned_agent_id?'required':''} ${canAssign?'':'disabled'} placeholder="${o.assigned_agent_id?'سبب إعادة التعيين':'سبب التعيين (اختياري)'}">
            <button class="secondary full" ${canAssign&&eligibleAgents.filter(a=>a.user_id!==o.assigned_agent_id).length?'':'disabled'}>${o.assigned_agent_id?'إعادة تعيين الوكيل':'تعيين الوكيل'}</button>
          </form>
          <button class="danger full" data-admin-cancel="${o.id}">إلغاء الطلب</button>
        `:''}
      </div>
    </details>

    ${(assignmentHistory||[]).length?`<details class="order-section">
      <summary>سجل التعيين</summary>
      <div class="order-section-body timeline">
        ${assignmentHistory.map(x=>`<div><b>${x.to_agent_id?'تعيين '+esc(agentNames[x.to_agent_id]?.full_name||'وكيل'):'إزالة التعيين'}</b><small>${esc(x.reason||'')}${x.created_at?' • '+new Date(x.created_at).toLocaleString('ar-LB'):''}</small></div>`).join('')}
      </div>
    </details>`:''}

    <details class="order-section">
      <summary>التتبّع (${events.length})</summary>
      <div class="order-section-body timeline">
        ${events.map(e=>`<div><b>${esc(e.label_ar)}</b><small>${e.note?esc(e.note)+' • ':''}${new Date(e.created_at).toLocaleString('ar-LB')}</small></div>`).join('')||'<div class="empty">لا توجد أحداث.</div>'}
      </div>
    </details>
  </section>`);
  bind();
}

function render(){
  const r=location.hash.slice(1)||'home';
  const anonymous=isAnonymousUser();

  if(passwordRecoveryMode&&!anonymous){
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
  if(r==='notifications'){
    if(anonymous||!['customer','agent'].includes(profile?.role))return go('home');
    return notificationsPage();
  }

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

  if(r==='properties'){
    if(anonymous||profile?.role!=='customer')return go('home');
    return customerPropertiesPage();
  }

  if(r==='documents'){
    if(anonymous||profile?.role!=='customer')return go('home');
    return customerDocumentsPage();
  }

  if(r==='payments'){
    if(anonymous||profile?.role!=='customer')return go('home');
    return customerPaymentsPage();
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

  if(r==='agent-earnings'){
    if(anonymous||profile?.role!=='agent')return go('home');
    return agentEarningsPage();
  }

  if(r==='staff')return go('admin');
  if(r==='admin')return profile?.role==='admin'?admin():adminAccess();
  if(r.startsWith('admin/')&&profile?.role==='admin')return admin(r.split('/')[1]);
  if(r.startsWith('admin-dispute/'))return profile?.role==='admin'?adminDispute(r.split('/')[1]):adminAccess();
  if(r.startsWith('admin-agent/'))return profile?.role==='admin'?adminAgent(r.split('/')[1]):adminAccess();
  if(r.startsWith('admin-order/'))return profile?.role==='admin'?adminOrder(r.split('/')[1]):adminAccess();

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

  const renderAddressEditor=async id=>{
    const box=document.querySelector('#addressEditor');
    if(!box)return;
    let a=null;
    if(id){
      const r=await supabase.from('customer_addresses').select('*').eq('id',id).single();
      if(r.error)return toast(r.error.message,true);
      a=r.data;
    }
    box.innerHTML=`<form id="addressForm" class="inline-editor">
      <input type="hidden" name="id" value="${esc(a?.id||'')}">
      <input name="label" value="${esc(a?.label||'المنزل')}" required placeholder="اسم العنوان">
      <input name="address_line1" value="${esc(a?.address_line1||'')}" required placeholder="العنوان">
      <input name="address_line2" value="${esc(a?.address_line2||'')}" placeholder="تفاصيل إضافية (اختياري)">
      <div class="grid">
        <input name="city" value="${esc(a?.city||'')}" required placeholder="المدينة">
        <input name="region" value="${esc(a?.region||'')}" placeholder="المنطقة / المحافظة">
      </div>
      <div class="grid">
        <input name="postal_code" value="${esc(a?.postal_code||'')}" placeholder="الرمز البريدي (اختياري)">
        <input name="country" value="${esc(a?.country||'Lebanon')}" required placeholder="الدولة">
      </div>
      <label class="checkline"><input type="checkbox" name="is_default" ${a?.is_default?'checked':''}> العنوان الافتراضي</label>
      <div class="row-actions"><button class="primary">حفظ</button><button type="button" class="secondary" data-cancel-editor>إلغاء</button></div>
    </form>`;
    box.querySelector('[data-cancel-editor]').onclick=()=>box.innerHTML='';
    box.querySelector('#addressForm').onsubmit=async e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget),b=e.currentTarget.querySelector('.primary');busy(b,true);
      const {error}=await supabase.rpc('save_customer_address',{
        p_id:fd.get('id')||null,p_label:fd.get('label'),p_address_line1:fd.get('address_line1'),
        p_address_line2:fd.get('address_line2')||null,p_city:fd.get('city'),p_region:fd.get('region')||null,
        p_postal_code:fd.get('postal_code')||null,p_country:fd.get('country'),p_is_default:fd.get('is_default')==='on'
      });
      busy(b,false);if(error)return toast(error.message,true);toast('تم حفظ العنوان');accountPage();
    };
  };

  document.querySelectorAll('[data-add-address]').forEach(x=>x.onclick=()=>renderAddressEditor(null));
  document.querySelectorAll('[data-edit-address]').forEach(x=>x.onclick=()=>renderAddressEditor(x.dataset.editAddress));
  document.querySelectorAll('[data-delete-address]').forEach(x=>x.onclick=async()=>{
    if(!confirm('حذف العنوان؟'))return;
    const {error}=await supabase.rpc('delete_customer_address',{p_id:x.dataset.deleteAddress});
    error?toast(error.message,true):(toast('تم حذف العنوان'),accountPage());
  });

  const renderPropertyEditor=async id=>{
    const box=document.querySelector('#propertyEditor');
    if(!box)return;
    let p=null;
    if(id){
      const r=await supabase.from('customer_properties').select('*').eq('id',id).single();
      if(r.error)return toast(r.error.message,true);
      p=r.data;
    }
    box.innerHTML=`<form id="propertyForm" class="inline-editor">
      <input type="hidden" name="id" value="${esc(p?.id||'')}">
      <input name="label" value="${esc(p?.label||'عقار')}" required placeholder="اسم العقار">
      <select name="governorate" required><option value="">المحافظة</option>${gov.map(g=>`<option ${p?.governorate===g?'selected':''}>${esc(g)}</option>`).join('')}</select>
      <input name="district" value="${esc(p?.district||'')}" placeholder="القضاء (اختياري)">
      <div class="grid">
        <input name="cadastral_area" value="${esc(p?.cadastral_area||'')}" required placeholder="المنطقة العقارية">
        <input name="property_number" value="${esc(p?.property_number||'')}" required placeholder="رقم العقار">
      </div>
      <input name="property_section" value="${esc(p?.property_section||'')}" placeholder="القسم / الحصة (اختياري)">
      <textarea name="notes" placeholder="ملاحظة (اختياري)">${esc(p?.notes||'')}</textarea>
      <label class="checkline"><input type="checkbox" name="is_default" ${p?.is_default?'checked':''}> العقار الافتراضي</label>
      <div class="row-actions"><button class="primary">حفظ</button><button type="button" class="secondary" data-cancel-editor>إلغاء</button></div>
    </form>`;
    box.querySelector('[data-cancel-editor]').onclick=()=>box.innerHTML='';
    box.querySelector('#propertyForm').onsubmit=async e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget),b=e.currentTarget.querySelector('.primary');busy(b,true);
      const {error}=await supabase.rpc('save_customer_property',{
        p_id:fd.get('id')||null,p_label:fd.get('label'),p_governorate:fd.get('governorate'),
        p_district:fd.get('district')||null,p_cadastral_area:fd.get('cadastral_area'),
        p_property_number:fd.get('property_number'),p_property_section:fd.get('property_section')||null,
        p_notes:fd.get('notes')||null,p_is_default:fd.get('is_default')==='on'
      });
      busy(b,false);if(error)return toast(error.message,true);toast('تم حفظ العقار');await load();customerPropertiesPage();
    };
  };

  document.querySelectorAll('[data-add-property]').forEach(x=>x.onclick=()=>renderPropertyEditor(null));
  document.querySelectorAll('[data-edit-property]').forEach(x=>x.onclick=()=>renderPropertyEditor(x.dataset.editProperty));
  document.querySelectorAll('[data-delete-property]').forEach(x=>x.onclick=async()=>{
    if(!confirm('حذف العقار؟'))return;
    const {error}=await supabase.rpc('delete_customer_property',{p_id:x.dataset.deleteProperty});
    if(error)return toast(error.message,true);
    toast('تم حذف العقار');await load();customerPropertiesPage();
  });

  const payoutAccountForm=document.querySelector('#payoutAccountForm');
  if(payoutAccountForm)payoutAccountForm.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(payoutAccountForm),b=payoutAccountForm.querySelector('button');busy(b,true);
    const {error}=await supabase.rpc('save_agent_payout_account',{
      p_account_holder:fd.get('account_holder'),p_bank_name:fd.get('bank_name')||null,p_iban:fd.get('iban')
    });
    busy(b,false);error?toast(error.message,true):(toast('تم حفظ بيانات التحويل'),accountPage());
  };

  document.querySelectorAll('[data-read-all-notifications]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',session.user.id).is('read_at',null);
    busy(x,false);
    error?toast(error.message,true):notificationsPage();
  });

  const deliveryConfigForm=document.querySelector('#deliveryConfigForm');
  if(deliveryConfigForm)deliveryConfigForm.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(deliveryConfigForm),b=deliveryConfigForm.querySelector('button');
    busy(b,true,'جارٍ الحفظ...');
    const {error}=await supabase.rpc('admin_update_hard_copy_delivery',{
      p_enabled:fd.get('enabled')==='on',
      p_customer_fee:Number(fd.get('customer_fee')||0),
      p_agent_payout:Number(fd.get('agent_payout')||0)
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    toast('تم حفظ إعدادات التوصيل');
    await load();
    admin('services');
  };

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
    passwordRecoveryMode=false;
    history.replaceState(null,'',location.pathname);
    toast('تم تغيير كلمة المرور');
    await load();
    if(profile?.role==='admin')return go('admin');
    if(profile?.role==='agent')return go('agent');
    return go('customer');
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

  const adminLogin=document.querySelector('#adminLogin');
  if(adminLogin)adminLogin.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(adminLogin);
    const email=String(fd.get('email')||'').trim().toLowerCase();
    const password=String(fd.get('password')||'');
    const b=adminLogin.querySelector('button');

    busy(b,true,'جارٍ الدخول...');
    await supabase.auth.signOut({scope:'local'});

    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error){
      busy(b,false);
      return toast('البريد أو كلمة المرور غير صحيحة.',true);
    }

    session=data.session;
    await load();

    if(profile?.role!=='admin'){
      await supabase.auth.signOut({scope:'local'});
      session=null;profile=null;
      await load();
      busy(b,false);
      return toast('هذا الحساب غير مخوّل للإدارة.',true);
    }

    toast('تم تسجيل الدخول');
    go('admin');
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
    profile?.role==='agent'?agentJob(supportForm.dataset.orderId):customerDetail(supportForm.dataset.orderId);
  };

  bindServiceSelection({services,bundleItems,serviceRequirements,savedProperties:customerProperties,savedAddresses:customerAddresses,deliveryConfig,money,toast});
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
      p_service_codes:f.getAll('service'),
      p_delivery_mode:f.get('delivery_mode')||'digital',
      p_delivery_address_id:f.get('delivery_mode')==='hard_copy'?(f.get('delivery_address_id')||null):null
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
        const path=orderId+'/customer/'+session.user.id+'/'+crypto.randomUUID()+'-'+safe;
        const up=await supabase.storage.from('order-files').upload(path,file);
        if(up.error){
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر رفع '+req.label_ar,true);
          return customerDetail(orderId);
        }

        const ins=await supabase.rpc('register_customer_attachment',{
          p_order_id:orderId,
          p_storage_path:path,
          p_original_name:file.name,
          p_mime_type:file.type,
          p_file_size:file.size
        });

        if(ins.error){
          await supabase.storage.from('order-files').remove([path]);
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر حفظ '+req.label_ar,true);
          return customerDetail(orderId);
        }

        const done=await supabase.rpc('complete_order_requirement',{
          p_order_requirement_id:req.id,
          p_value_text:null,
          p_document_id:ins.data?.id
        });
        if(done.error){
          if(ins.data?.id)await supabase.from('documents').delete().eq('id',ins.data.id);
          await supabase.storage.from('order-files').remove([path]);
          busy(b,false);
          toast('تم إنشاء الطلب، لكن تعذر إكمال '+req.label_ar,true);
          return customerDetail(orderId);
        }
      }
    }

    const finalized=await supabase.rpc('finalize_order_submission',{p_order_id:orderId});
    if(finalized.error){
      busy(b,false);
      toast(finalized.error.message==='requirements_incomplete'?'تم إنشاء الطلب، أكمل المعلومات المطلوبة ثم أرسله للوكلاء':finalized.error.message,true);
      return customerDetail(orderId);
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
    busy(x,true,'جارٍ الفتح...');
    const {data,error}=await supabase.storage.from('agent-files').createSignedUrl(x.dataset.agentDocView,300);
    busy(x,false);
    if(error)return toast(error.message,true);

    document.querySelector('#fileViewer')?.remove();
    const viewer=document.createElement('div');
    viewer.id='fileViewer';
    viewer.className='file-viewer';
    viewer.innerHTML=`
      <div class="file-viewer-card">
        <div class="file-viewer-head"><b>المستند</b><button type="button" class="secondary compact" data-close-file-viewer>إغلاق</button></div>
        <div class="file-viewer-body"><iframe src="${data.signedUrl}" title="المستند"></iframe></div>
      </div>`;
    document.body.appendChild(viewer);
    const close=()=>viewer.remove();
    viewer.querySelector('[data-close-file-viewer]').onclick=close;
    viewer.onclick=e=>{if(e.target===viewer)close()};
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
    busy(b,false);
    if(error)return toast(error.message,true);
    toast('تم تحديث منطقة العمل');
    location.hash==='#account'?accountPage():agentPortal();
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

  document.querySelectorAll('[data-generate-cash-pin]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ إنشاء الرمز...');
    const {data,error}=await supabase.rpc('customer_generate_cash_payment_pin',{p_order_id:x.dataset.generateCashPin});
    busy(x,false);
    if(error)return toast(error.message==='work_not_ready'?'الطلب لم يجهز للدفع بعد':error.message,true);
    const holder=x.closest('.completebox')?.querySelector('[data-cash-pin-result]');
    if(holder)holder.innerHTML='<strong style="font-size:24px;letter-spacing:4px">'+esc(data)+'</strong><small>لا تعطِ الرمز للوكيل قبل تسليم المبلغ نقداً.</small>';
  });

  const cashPinForm=document.querySelector('#cashPinForm');
  if(cashPinForm)cashPinForm.onsubmit=async e=>{
    e.preventDefault();
    const b=cashPinForm.querySelector('button');
    const pin=String(new FormData(cashPinForm).get('pin')||'').trim();
    busy(b,true,'جارٍ التأكيد...');
    const {data,error}=await supabase.rpc('agent_confirm_cash_payment',{p_order_id:cashPinForm.dataset.orderId,p_pin:pin});
    busy(b,false);
    if(error)return toast(error.message,true);
    if(data!=='paid'){
      const msg=data==='invalid_cash_pin'?'الرمز غير صحيح':
        data==='cash_pin_not_generated'?'اطلب من العميل إظهار رمز الدفع أولاً':
        data==='cash_pin_locked'?'تم إيقاف الرمز بعد محاولات خاطئة. اطلب من العميل إنشاء رمز جديد.':
        data==='cash_pin_already_used'?'تم استخدام هذا الرمز مسبقاً':data;
      return toast(msg,true);
    }
    toast('تم تأكيد الدفع النقدي');
    agentJob(cashPinForm.dataset.orderId);
  };

  document.querySelectorAll('[data-confirm-hard-copy]').forEach(x=>x.onclick=async()=>{
    if(!confirm('تأكيد أنك سلّمت النسخة الورقية للعميل؟'))return;
    busy(x,true,'جارٍ التأكيد...');
    const {error}=await supabase.rpc('confirm_hard_copy_delivery',{p_order_id:x.dataset.confirmHardCopy,p_note:null});
    busy(x,false);
    error?toast(error.message,true):(toast('تم تأكيد التوصيل'),agentJob(x.dataset.confirmHardCopy));
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
    const path=x.dataset.orderId+'/agent/'+session.user.id+'/'+crypto.randomUUID()+'-'+safe;
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

  document.querySelectorAll('[data-file-view]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ الفتح...');
    const {data,error}=await supabase.storage.from('order-files').createSignedUrl(x.dataset.fileView,300);
    busy(x,false);
    if(error)return toast(error.message,true);

    const name=x.dataset.fileName||'مستند';
    const mime=x.dataset.fileMime||'';
    const url=data.signedUrl;
    const isImage=mime.startsWith('image/')||/\.(png|jpe?g|webp|gif)$/i.test(name);
    const isPdf=mime==='application/pdf'||/\.pdf$/i.test(name);

    document.querySelector('#fileViewer')?.remove();
    const viewer=document.createElement('div');
    viewer.id='fileViewer';
    viewer.className='file-viewer';
    viewer.innerHTML=`
      <div class="file-viewer-card">
        <div class="file-viewer-head">
          <b>${esc(name)}</b>
          <button type="button" class="secondary compact" data-close-file-viewer>إغلاق</button>
        </div>
        <div class="file-viewer-body">
          ${isImage
            ?`<img src="${url}" alt="${esc(name)}">`
            :isPdf
              ?`<iframe src="${url}" title="${esc(name)}"></iframe>`
              :`<div class="empty">لا يمكن عرض هذا النوع داخل الصفحة.</div>`}
        </div>
        <div class="file-viewer-actions">
          <button type="button" class="secondary full" data-viewer-download>تنزيل</button>
        </div>
      </div>`;
    document.body.appendChild(viewer);

    const close=()=>viewer.remove();
    viewer.querySelector('[data-close-file-viewer]').onclick=close;
    viewer.onclick=e=>{if(e.target===viewer)close()};
    viewer.querySelector('[data-viewer-download]').onclick=async()=>{
      const {data:downloadData,error:downloadError}=await supabase.storage
        .from('order-files')
        .createSignedUrl(x.dataset.fileView,300,{download:true});
      if(downloadError)return toast(downloadError.message,true);
      window.location.href=downloadData.signedUrl;
    };
  });

  document.querySelectorAll('[data-file-download]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ التنزيل...');
    const {data,error}=await supabase.storage.from('order-files').createSignedUrl(x.dataset.fileDownload,300,{download:true});
    busy(x,false);
    if(error)return toast(error.message,true);
    window.location.href=data.signedUrl;
  });

  document.querySelectorAll('[data-download]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ الفتح...');
    const {data,error}=await supabase.storage.from('order-files').createSignedUrl(x.dataset.download,300);
    busy(x,false);
    if(error)return toast(error.message,true);
    window.location.href=data.signedUrl;
  });

  document.querySelectorAll('[data-finalize-order]').forEach(x=>x.onclick=async()=>{
    busy(x,true,'جارٍ الإرسال...');
    const {error}=await supabase.rpc('finalize_order_submission',{p_order_id:x.dataset.finalizeOrder});
    busy(x,false);
    if(error){
      const msg=error.message==='requirements_incomplete'?'أكمل المعلومات المطلوبة أولاً':error.message;
      return toast(msg,true);
    }
    toast('تم إرسال الطلب للوكلاء');
    customerDetail(x.dataset.finalizeOrder);
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
    const {error}=await supabase.rpc('admin_reassign_order',{p_order_id:id,p_agent_id:d.get('agent'),p_reason:d.get('reason')||''});
    busy(b,false);error?toast(error.message,true):(toast('تم تعيين الوكيل'),adminOrder(id));
  };

  document.querySelectorAll('[data-mark-payment-paid]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('admin_mark_payment_paid',{
      p_payment_id:x.dataset.markPaymentPaid,
      p_provider:'cash',
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

  document.querySelectorAll('[data-payout-account-verify]').forEach(x=>x.onclick=async()=>{
    busy(x,true);
    const {error}=await supabase.rpc('admin_set_agent_payout_account_verified',{
      p_agent_id:x.dataset.payoutAccountVerify,
      p_verified:x.dataset.verifyValue==='true'
    });
    busy(x,false);
    error?toast(error.message,true):(toast(x.dataset.verifyValue==='true'?'تم اعتماد حساب التحويل':'تم إلغاء اعتماد الحساب'),adminAgent(x.dataset.payoutAccountVerify));
  });

  document.querySelectorAll('[data-create-payout]').forEach(x=>x.onclick=async()=>{
    if(!confirm('إنشاء دفعة من كامل الرصيد المتاح؟'))return;
    busy(x,true);
    const {error}=await supabase.rpc('create_payout_batch',{p_agent_id:x.dataset.createPayout,p_currency:'USD'});
    busy(x,false);
    error?toast(
      error.message==='payout_account_required'?'لا يوجد حساب تحويل محفوظ':
      error.message==='payout_account_not_verified'?'يجب اعتماد حساب التحويل أولاً':
      error.message,true
    ):(toast('تم إنشاء الدفعة'),adminAgent(x.dataset.createPayout));
  });

  document.querySelectorAll('[data-payout-paid]').forEach(x=>x.onclick=async()=>{
    const reference=prompt('مرجع التحويل (اختياري)')||'';
    busy(x,true);
    const {error}=await supabase.rpc('admin_mark_payout_paid',{
      p_payout_id:x.dataset.payoutPaid,
      p_provider:'cash',
      p_reference:reference||null
    });
    busy(x,false);
    error?toast(error.message,true):(toast('تم تسجيل الدفعة كمدفوعة'),adminAgent(x.dataset.agentId));
  });

  document.querySelectorAll('[data-payout-cancel]').forEach(x=>x.onclick=async()=>{
    if(!confirm('إلغاء هذه الدفعة وإعادة الرصيد إلى المتاح؟'))return;
    busy(x,true);
    const {error}=await supabase.rpc('admin_cancel_payout',{p_payout_id:x.dataset.payoutCancel});
    busy(x,false);
    error?toast(error.message,true):(toast('تم إلغاء الدفعة وإعادة الرصيد'),adminAgent(x.dataset.agentId));
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

supabase.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY'){
    passwordRecoveryMode=true;
    setTimeout(async()=>{
      await load();
      resetPasswordPage();
    },0);
  }
});

try {
  await load();
  render();
} catch (err) {
  console.error(err);
  app.innerHTML='<main><section class="card narrow"><h2>تعذر فتح الصفحة</h2><p>حدّث الصفحة وحاول مرة أخرى.</p></section></main>';
}
