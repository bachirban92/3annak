export function renderNewOrder({services,bundleItems,serviceRequirements,savedProperties=[],savedAddresses=[],deliveryConfig={},profile,gov,esc,money}){
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
    <div class="title"><h2>طلب جديد</h2><button data-go="customer">رجوع</button></div>
    <form id="order">
      <section class="flowstep">
        <div class="stephead"><span>1</span><div><b>اختر الخدمة</b><small>اختر مستنداً أو أكثر، أو حزمة كاملة.</small></div></div>
        <div class="servicegrid">${cards}</div>
      </section>

      <section class="flowstep orderdetails" id="orderDetails" hidden>
        <div class="stephead"><span>2</span><div><b>بيانات العقار</b><small>المعلومات التي تحدد العقار.</small></div></div>
        ${savedProperties.length?`<select id="savedPropertySelect">
          <option value="">إدخال عقار جديد</option>
          ${savedProperties.map(p=>`<option value="${esc(p.id)}">${esc(p.label)} • ${esc(p.cadastral_area)} • ${esc(p.property_number)}</option>`).join('')}
        </select>`:''}
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

      <section class="flowstep orderdetails" id="preorderRequirementsSection" hidden>
        <div class="stephead"><span>3</span><div><b>المعلومات المطلوبة</b><small>تتغير تلقائياً حسب الخدمة التي اخترتها.</small></div></div>
        <div id="preorderRequirements" class="prerequirements"></div>
      </section>

      <section class="flowstep orderdetails" hidden>
        <div class="stephead"><span>4</span><div><b>بيانات التواصل</b><small>للتحديثات والمستندات.</small></div></div>
        <input name="name" value="${esc(profile?.full_name||'')}" required placeholder="الاسم">
        <input name="email" type="email" value="${esc(profile?.email||'')}" required placeholder="البريد الإلكتروني">
        <input name="phone" value="${esc(profile?.phone||'')}" required placeholder="رقم الهاتف">
        <textarea name="notes" placeholder="ملاحظة (اختياري)"></textarea>
      </section>

      <section class="flowstep orderdetails" id="deliverySection" hidden>
        <div class="stephead"><span>5</span><div><b>طريقة الاستلام</b><small>اختر نسخة إلكترونية فقط أو توصيل النسخ الورقية.</small></div></div>
        <div class="delivery-choice">
          <label class="delivery-option selected">
            <input type="radio" name="delivery_mode" value="digital" checked>
            <span><b>نسخة إلكترونية</b><small>تستلم المستندات داخل حسابك</small></span>
            <strong>بدون توصيل</strong>
          </label>
          ${deliveryConfig?.enabled?`<label class="delivery-option">
            <input type="radio" name="delivery_mode" value="hard_copy">
            <span><b>نسخة ورقية + إلكترونية</b><small>الوكيل يوصل النسخ الورقية إلى عنوانك</small></span>
            <strong>+${money(deliveryConfig.customer_fee||0)}</strong>
          </label>`:''}
        </div>
        <div id="deliveryAddressWrap" hidden>
          ${savedAddresses.length?`<select name="delivery_address_id">
            <option value="">اختر عنوان التوصيل</option>
            ${savedAddresses.map(a=>`<option value="${esc(a.id)}" ${a.is_default?'selected':''}>${esc(a.label)} • ${esc(a.address_line1)} • ${esc(a.city)}</option>`).join('')}
          </select>`:`<div class="empty">أضف عنواناً في حسابك أولاً لاختيار التوصيل الورقي.</div>`}
        </div>
      </section>

      <section class="flowstep orderreview" id="orderReview" hidden>
        <div class="stephead"><span>6</span><div><b>راجع الطلب</b><small>تأكد من التفاصيل قبل التأكيد.</small></div></div>
        <div class="reviewgrid">
          <div><small>الخدمة</small><b id="reviewServices"></b></div>
          <div><small>العقار</small><b id="reviewProperty">—</b></div>
          <div><small>المطلوب منك</small><b id="reviewRequirements">—</b></div>
          <div><small>الاستلام</small><b id="reviewDelivery">نسخة إلكترونية</b></div>
          <div><small>الإجمالي</small><b id="reviewTotal"></b></div>
        </div>
        <label class="terms-check">
          <input type="checkbox" name="terms_agreed" required>
          <span>أوافق على <button type="button" class="linkbutton" data-go="terms">الشروط والأحكام</button> وألتزم بدفع قيمة الطلب عند إنجاز الخدمة، وأفهم أن رمز الدفع النقدي لا يُعطى للوكيل إلا بعد دفع المبلغ.</span>
        </label>
      </section>

      <div class="ordersummary" id="orderSummary" hidden>
        <div><small>طلبك</small><b id="orderSummaryNames"></b></div>
        <strong id="orderSummaryTotal"></strong>
        <button class="primary" id="orderSubmit">تأكيد الطلب</button>
      </div>
    </form>
  </section>`;
}

export function bindServiceSelection({services,bundleItems,serviceRequirements,savedProperties=[],savedAddresses=[],deliveryConfig={},money,toast}){
  const form=document.querySelector('#order');
  if(!form)return;

  const checks=[...form.querySelectorAll('[data-service-code]')];
  const detailSections=[...form.querySelectorAll('.orderdetails')];
  const summary=form.querySelector('#orderSummary');
  const review=form.querySelector('#orderReview');
  const names=form.querySelector('#orderSummaryNames');
  const totalEl=form.querySelector('#orderSummaryTotal');
  const reviewServices=form.querySelector('#reviewServices');
  const reviewProperty=form.querySelector('#reviewProperty');
  const reviewRequirements=form.querySelector('#reviewRequirements');
  const reviewDelivery=form.querySelector('#reviewDelivery');
  const reviewTotal=form.querySelector('#reviewTotal');
  const reqSection=form.querySelector('#preorderRequirementsSection');
  const reqContainer=form.querySelector('#preorderRequirements');
  const byCode=Object.fromEntries(services.map(s=>[s.code,s]));
  const bundleMap={};

  for(const row of bundleItems||[]){
    (bundleMap[row.bundle_service_id]??=[]).push(row.item_service_id);
  }

  const selectedRequirements=chosen=>{
    const ids=new Set();
    chosen.forEach(s=>{
      ids.add(s.id);
      if(s.service_type==='bundle'){
        (bundleMap[s.id]||[]).forEach(id=>ids.add(id));
      }
    });

    const rows=(serviceRequirements||[])
      .filter(r=>r.active!==false&&ids.has(r.service_id))
      .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));

    const seen=new Map();
    for(const row of rows){
      const old=seen.get(row.code);
      if(!old)seen.set(row.code,{...row});
      else if(row.required&&!old.required)seen.set(row.code,{...old,required:true});
    }
    return [...seen.values()];
  };

  const escAttr=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const renderReqs=reqs=>{
    if(!reqs.length){
      reqContainer.innerHTML='<div class="empty">لا توجد معلومات إضافية مطلوبة لهذه الخدمة.</div>';
      reqSection.hidden=false;
      return;
    }

    reqContainer.innerHTML=reqs.map(r=>{
      const required=r.required?'required':'';
      const badge=r.required?'مطلوب':'اختياري';
      const safeCode=escAttr(r.code);
      if(r.requirement_type==='file'){
        return `<label class="prereq">
          <span><b>${escAttr(r.label_ar)}</b><small>${badge}</small></span>
          <input type="file" name="req_file__${safeCode}" data-pre-req-code="${safeCode}" data-pre-req-type="file" ${required} accept=".pdf,image/jpeg,image/png,image/webp">
        </label>`;
      }
      const defaultAddress=(savedAddresses||[]).find(a=>a.is_default);
      const preset=r.code==='applicant_address'&&defaultAddress
        ?[defaultAddress.address_line1,defaultAddress.address_line2,defaultAddress.city,defaultAddress.region,defaultAddress.country].filter(Boolean).join('، ')
        :'';
      return `<label class="prereq">
        <span><b>${escAttr(r.label_ar)}</b><small>${badge}</small></span>
        <input name="req_text__${safeCode}" data-pre-req-code="${safeCode}" data-pre-req-type="text" ${required} value="${escAttr(preset)}" placeholder="${escAttr(r.label_ar)}">
      </label>`;
    }).join('');
    reqSection.hidden=false;
  };

  const updateReview=()=>{
    const selected=checks.filter(x=>x.checked);
    const chosen=selected.map(x=>byCode[x.value]).filter(Boolean);
    if(!chosen.length)return;

    const reqs=selectedRequirements(chosen);
    const required=reqs.filter(r=>r.required);
    const completed=required.filter(r=>{
      const input=form.querySelector(`[data-pre-req-code="${CSS.escape(r.code)}"]`);
      if(!input)return false;
      return input.type==='file'?!!input.files?.[0]:!!input.value?.trim();
    }).length;

    const gov=form.elements.governorate?.value||'';
    const district=form.elements.district?.value||'';
    const cadastral=form.elements.cadastral_area?.value||'';
    const property=form.elements.property_number?.value||'';
    const propertyBits=[gov,district,cadastral,property?`عقار ${property}`:''].filter(Boolean);

    const deliveryMode=form.elements.delivery_mode?.value||'digital';
    const deliveryFee=deliveryMode==='hard_copy'?Number(deliveryConfig.customer_fee||0):0;
    const total=chosen.reduce((sum,s)=>sum+Number(s.customer_price||0)+Number(s.official_fee||0),0)+deliveryFee;
    reviewServices.textContent=chosen.map(x=>x.name_ar).join('، ');
    reviewProperty.textContent=propertyBits.join(' • ')||'—';
    reviewRequirements.textContent=required.length?`${completed}/${required.length} مكتمل`:'لا يوجد متطلبات إضافية';
    reviewDelivery.textContent=deliveryMode==='hard_copy'?`نسخة ورقية + إلكترونية (+${money(deliveryFee)})`:'نسخة إلكترونية';
    reviewTotal.textContent=money(total);
  };

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
    review.hidden=!active;

    form.querySelectorAll('.servicecard').forEach(card=>{
      const input=card.querySelector('input');
      card.classList.toggle('selected',!!input?.checked);
    });

    if(!active){
      reqSection.hidden=true;
      reqContainer.innerHTML='';
      return;
    }

    const chosen=selected.map(x=>byCode[x.value]).filter(Boolean);
    const reqs=selectedRequirements(chosen);
    renderReqs(reqs);

    const deliveryMode=form.elements.delivery_mode?.value||'digital';
    const deliveryFee=deliveryMode==='hard_copy'?Number(deliveryConfig.customer_fee||0):0;
    const total=chosen.reduce((sum,s)=>sum+Number(s.customer_price||0)+Number(s.official_fee||0),0)+deliveryFee;
    names.textContent=chosen.map(x=>x.name_ar).join('، ');
    totalEl.textContent=money(total);
    updateReview();
  };

  const savedPropertySelect=form.querySelector('#savedPropertySelect');
  if(savedPropertySelect){
    savedPropertySelect.onchange=()=>{
      const p=savedProperties.find(x=>x.id===savedPropertySelect.value);
      if(!p)return;
      form.elements.governorate.value=p.governorate||'';
      form.elements.district.value=p.district||'';
      form.elements.cadastral_area.value=p.cadastral_area||'';
      form.elements.property_number.value=p.property_number||'';
      form.elements.property_section.value=p.property_section||'';
      updateReview();
    };
    const def=savedProperties.find(x=>x.is_default);
    if(def){
      savedPropertySelect.value=def.id;
      savedPropertySelect.onchange();
    }
  }

  form.querySelectorAll('input[name="delivery_mode"]').forEach(r=>r.addEventListener('change',()=>{
    form.querySelectorAll('.delivery-option').forEach(x=>x.classList.toggle('selected',x.querySelector('input')?.checked));
    const hard=form.elements.delivery_mode?.value==='hard_copy';
    const wrap=form.querySelector('#deliveryAddressWrap');
    if(wrap)wrap.hidden=!hard;
    updateReview();
  }));
  checks.forEach(x=>x.addEventListener('change',()=>refresh(x)));
  form.addEventListener('input',updateReview);
  form.addEventListener('change',e=>{
    if(e.target?.matches?.('[data-pre-req-code],select'))updateReview();
  });

  form.addEventListener('submit',e=>{
    if(!checks.some(x=>x.checked)){
      e.preventDefault();
      toast?.('اختر خدمة واحدة على الأقل',true);
      return;
    }

    const missing=[...form.querySelectorAll('[data-pre-req-code][required]')].some(input=>
      input.type==='file'?!input.files?.[0]:!input.value?.trim()
    );
    if(missing){
      e.preventDefault();
      toast?.('أكمل المعلومات المطلوبة قبل تأكيد الطلب',true);
      return;
    }
    if(form.elements.delivery_mode?.value==='hard_copy'&&!form.elements.delivery_address_id?.value){
      e.preventDefault();
      toast?.('اختر عنوان التوصيل للنسخة الورقية',true);
      return;
    }
    if(!form.elements.terms_agreed?.checked){
      e.preventDefault();
      toast?.('وافق على الشروط قبل تأكيد الطلب',true);
    }
  });
}
