import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="top">
    <div class="brand">عنّك</div>
    <button class="link" id="trackBtn">تتبّع طلب</button>
  </header>

  <main>
    <section class="hero">
      <h1>اطلب أوراق عقارك.<br>ونحن نتابعها عنك.</h1>
      <p>أدخل معلومات العقار واختر المستند المطلوب.</p>
      <button class="primary" id="startBtn">طلب جديد</button>
    </section>

    <section class="card hidden" id="requestCard">
      <h2>طلب جديد</h2>
      <form id="requestForm">
        <label>المنطقة العقارية</label>
        <input name="cadastral_area" required placeholder="مثال: أنطلياس" />

        <label>رقم العقار</label>
        <input name="property_number" required inputmode="numeric" placeholder="مثال: 1234" />

        <label>المستند</label>
        <select name="service" required>
          <option value="">اختر</option>
          <option value="property_certificate">إفادة عقارية</option>
          <option value="cadastral_map">خريطة مساحة</option>
          <option value="planning_easement">إفادة ارتفاق وتخطيط</option>
          <option value="full_file">ملف عقار كامل</option>
        </select>

        <label>رقم الهاتف</label>
        <input name="phone" required inputmode="tel" placeholder="+961 ..." />

        <button class="primary full" type="submit">إرسال الطلب</button>
      </form>
    </section>

    <section class="card hidden" id="trackCard">
      <h2>تتبّع طلب</h2>
      <input id="trackInput" placeholder="رقم الطلب" />
      <button class="primary full" id="lookupBtn">عرض الطلب</button>
      <div id="trackResult"></div>
    </section>
  </main>
`;

const requestCard = document.querySelector('#requestCard');
const trackCard = document.querySelector('#trackCard');

document.querySelector('#startBtn').addEventListener('click', () => {
  requestCard.classList.remove('hidden');
  trackCard.classList.add('hidden');
  requestCard.scrollIntoView({behavior:'smooth'});
});

document.querySelector('#trackBtn').addEventListener('click', () => {
  trackCard.classList.remove('hidden');
  requestCard.classList.add('hidden');
  trackCard.scrollIntoView({behavior:'smooth'});
});

document.querySelector('#requestForm').addEventListener('submit', (e) => {
  e.preventDefault();
  alert('تم تجهيز الواجهة. الخطوة التالية ربطها بقاعدة Supabase.');
});

document.querySelector('#lookupBtn').addEventListener('click', () => {
  const value = document.querySelector('#trackInput').value.trim();
  document.querySelector('#trackResult').innerHTML = value
    ? `<div class="status"><strong>${value}</strong><span>سيظهر التتبّع هنا بعد ربط Supabase.</span></div>`
    : '';
});
