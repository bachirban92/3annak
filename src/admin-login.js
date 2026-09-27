import { supabase } from './supabase.js';

const root=document.querySelector('#admin-login');

function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderLogin(message=''){
  root.innerHTML=`
    <header><div class="brand">عنّك</div></header>
    <main class="adminloginmain">
      <section class="card narrow adminlogincard">
        <div class="adminloginmark">إدارة</div>
        <h2>دخول الإدارة</h2>
        ${message?`<div class="loginmessage">${esc(message)}</div>`:''}
        <form id="adminLoginForm">
          <input name="email" type="email" autocomplete="username" required placeholder="البريد الإلكتروني">
          <input name="password" type="password" autocomplete="current-password" required placeholder="كلمة المرور">
          <button class="primary full">دخول</button>
        </form>
      </section>
    </main>`;
  document.querySelector('#adminLoginForm').onsubmit=login;
}

async function checkAdmin(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)return false;

  const {data:profile,error}=await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id',session.user.id)
    .maybeSingle();

  if(error||!profile||profile.role!=='admin'||profile.is_active===false){
    await supabase.auth.signOut();
    return false;
  }
  location.replace('./#admin');
  return true;
}

async function login(e){
  e.preventDefault();
  const form=e.currentTarget;
  const button=form.querySelector('button');
  const data=new FormData(form);
  button.disabled=true;
  button.textContent='جارٍ الدخول...';

  const {error}=await supabase.auth.signInWithPassword({
    email:String(data.get('email')||'').trim(),
    password:String(data.get('password')||'')
  });

  if(error){
    button.disabled=false;
    button.textContent='دخول';
    renderLogin('بيانات الدخول غير صحيحة.');
    return;
  }

  const ok=await checkAdmin();
  if(!ok)renderLogin('هذا الحساب غير مخوّل للإدارة.');
}

if(!(await checkAdmin()))renderLogin();
