export function renderNewOrder({services,bundleItems,profile,gov,esc,money}){
  const byId=Object.fromEntries(services.map(s=>[s.id,s]));
  const bundleMap={};
  for(const row of bundleItems||[]){
    (bundleMap[row.bundle_service_id]??=[]).push(row);
  }

  const cards=services.map(s=>{
    const total=Number(s.customer_price||0)+Number(s.official_fee||0);
    const items=(bundleMap[s.id]||[]).map(x=>byId[x.item_service_id]).filter(Boolean);
    const eta=s.expected_days_min&&s.expected_days_max
      ? (s.expected_days_min===s.expected_days_max?String(s.expected_days_min):s.expected_days_min+'–'+s.expected_days_max)+' أيام'
      :'';
    return `<label class="servicecard ${items.length?'bundlecard':''}" data-service-card="${esc(s.code)}">
      <input type="checkbox" name="service" value="${esc(s.code)}" data-service-code="${esc(s.code)}" data-service-id="${esc(s.id)}">
      <span class="servicecheck">✓</span>
      <span class="servicecopy">
        <span class="servicetop"><b>${esc(s.name_ar)}</b><strong>${money(total)}</strong></span>
        ${s.description_ar?`<small>${esc(s.description_ar)}</small>`:''}
        ${eta?`<em>${eta}</em>`:''}
        ${items.length?`<span class="bundleitems">${items.map(i=>`<i>${esc(i.name_ar)}</i>`).join('')}</span>`:''}
      </span>
    </label>`;
  }).join('');

  return `<section class="orderflow">
    <div class="title"><h2>طلب جديد</h2><button data-go="home">رجوع</button></div>
    <form id="order">
      <section class="flowstep">
        <div class="stephead"><span>1</span><div><b>اختر الخدمة</b><small>يمكنك اختيار أكثر من مستند، أو الملف الكامل.</small></div></div>
        <div class="servicegrid">${cards}</div>
      </section>

      <section class="flowstep orderdetails" id="orderDetails" hidden>
        <div class="stephead"><span>2</span><div><b>بيانات العقار</b><small>نحتاج فقط المعلومات التي تحدد العقار.</small></div></div>
        <div class="grid">
          <select name="governorate" required><option value="">المحافظة</option>${gov.map(x=>`<option>${esc(x)}</option>`).join('')}</select>
          <input name="district" placeholder="القضاء (اختياري)">
        </div>
        <div class="grid">
          <input name="cadastral_area" required placeholder="المنطقة العقارية">
          <input name="property_number" required placeholder="رقم العقار">
        </div>
        <input name="property_section" placeholder="القسم / الحصة (إذا وجد)">
      </section>

      <section class="flowstep orderdetails" hidden>
        <div class="stephead"><span>3</span><div><b>بيانات التواصل</b><small>لإرسال التحديثات والمستندات.</small></div></div>
        <input name="name" value="${esc(profile?.full_name||'')}" placeholder="الاسم">
        <input name="email" type="email" value="${esc(profile?.email||'')}" required placeholder="البريد الإلكتروني">
        <input name="phone" value="${esc(profile?.phone||'')}" required placeholder="رقم الهاتف">
        <textarea name="notes" placeholder="ملاحظة (اختياري)"></textarea>
      </section>

      <div class="ordersummary" id="orderSummary" hidden>
        <div><small id="orderSummaryLabel">الخدمات المختارة</small><b id="orderSummaryNames"></b></div>
        <strong id="orderSummaryTotal"></strong>
        <button class="primary" id="orderSubmit">تأكيد الطلب</button>
      </div>
    </form>
  </section>`;
}

export function bindServiceSelection({services,money,toast}){
  const form=document.querySelector('#order');
  if(!form)return;
  const checks=[...form.querySelectorAll('[data-service-code]')];
  const detailSections=[...form.querySelectorAll('.orderdetails')];
  const summary=form.querySelector('#orderSummary');
  const names=form.querySelector('#orderSummaryNames');
  const totalEl=form.querySelector('#orderSummaryTotal');
  const byCode=Object.fromEntries(services.map(s=>[s.code,s]));

  const refresh=changed=>{
    const changedService=changed?byCode[changed.value]:null;
    if(changedService?.service_type==='bundle'&&changed.checked){
      checks.forEach(x=>{if(x!==changed)x.checked=false});
    }else if(changed&&changed.checked&&changedService?.service_type!=='bundle'){
      checks.forEach(x=>{if(byCode[x.value]?.service_type==='bundle')x.checked=false});
    }

    const selected=checks.filter(x=>x.checked);
    const active=selected.length>0;
    detailSections.forEach(x=>x.hidden=!active);
    summary.hidden=!active;
    form.querySelectorAll('.servicecard').forEach(card=>{
      const input=card.querySelector('input');
      card.classList.toggle('selected',!!input?.checked);
    });

    if(!active)return;
    const chosen=selected.map(x=>byCode[x.value]).filter(Boolean);
    names.textContent=chosen.map(x=>x.name_ar).join('، ');
    totalEl.textContent=money(chosen.reduce((sum,s)=>sum+Number(s.customer_price||0)+Number(s.official_fee||0),0));
  };

  checks.forEach(x=>x.addEventListener('change',()=>refresh(x)));
  form.addEventListener('submit',e=>{
    if(!checks.some(x=>x.checked)){
      e.preventDefault();
      toast?.('اختر خدمة واحدة على الأقل',true);
    }
  });
}
