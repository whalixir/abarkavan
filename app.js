// =============================================================
// Abarkavan Fleet Accounting — app.js v5
// =============================================================
const API_BASE = "https://abarkavan.4dgwb9f5dh.workers.dev";

const VESSELS = [
  { key:"ABARKAVAN",   label:"ABARKAVAN",   icon:"⚓" },
  { key:"ABARKAVAN 1", label:"ABARKAVAN 1", icon:"⚓" },
  { key:"ABARKAVAN 4", label:"ABARKAVAN 4", icon:"⚓" },
  { key:"NONAME",      label:"NONAME",      icon:"⚓" },
];
const SECTIONS = [
  { key:"general_expense", label:"مخارج عمومی",     type:"transactions" },
  { key:"salary",          label:"حقوق و مزایا",    type:"transactions" },
  { key:"shareholders",    label:"سهامداران",        type:"shareholders" },
  { key:"income_received", label:"درآمد وصول‌شده",  type:"transactions" },
  { key:"income_pending",  label:"درآمد وصول‌نشده", type:"transactions" },
  { key:"chart",           label:"نمودار",           type:"chart"       },
  { key:"statement",       label:"صورت‌حساب ماهانه",type:"statement"   },
  { key:"trash",           label:"حذف شده‌ها",      type:"trash"       },
];
const CATEGORY_LABELS = {
  general_expense:"مخارج عمومی", salary:"حقوق و مزایا پرسنل",
  income_received:"درآمد وصول‌شده", income_pending:"درآمد وصول‌نشده",
};
const PARTNERS_ABARKAVAN = [
  {name:"عبدالله ملائی",dang:2.5},{name:"مصلح‌الدین",dang:1.5},
  {name:"طیب",dang:1},{name:"شمس‌الدین",dang:1},
];
const PARTNERS_OTHER = [
  {name:"عبدالله ملائی",dang:2},{name:"مصلح‌الدین",dang:2},
  {name:"طیب",dang:1},{name:"شمس‌الدین",dang:1},
];
const PARTNERS = {
  "ABARKAVAN":PARTNERS_ABARKAVAN,"ABARKAVAN 1":PARTNERS_OTHER,
  "ABARKAVAN 4":PARTNERS_OTHER,"NONAME":PARTNERS_OTHER,
};
const state = {
  token:localStorage.getItem("lc_token")||null,
  name:localStorage.getItem("lc_name")||null,
  isAdmin:localStorage.getItem("lc_admin")==="1",
  vessel:localStorage.getItem("lc_vessel")||VESSELS[0].key,
  section:SECTIONS[0].key, rate:null,
};
const charts={};

// ── Audio ────────────────────────────────────────────────────
const AudioCtx = window.AudioContext||window.webkitAudioContext;
let _actx=null;
function getACtx(){ if(!_actx&&AudioCtx) _actx=new AudioCtx(); return _actx; }
function playBeep(freq=880,dur=0.08,type="sine"){
  try{
    const ac=getACtx(); if(!ac) return;
    const osc=ac.createOscillator(); const g=ac.createGain();
    osc.type=type; osc.frequency.value=freq;
    g.gain.setValueAtTime(0.3,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime+dur);
  }catch(e){}
}
function playConfirm(){ playBeep(880,0.06); setTimeout(()=>playBeep(1320,0.08),70); }
function playClick(){ playBeep(660,0.04,"square"); }

// ── Idle timer (15 min) ──────────────────────────────────────
let _idleTimer=null;
let _idleWatching=false;
function resetIdle(){
  clearTimeout(_idleTimer);
  _idleTimer=setTimeout(()=>{ if(state.token) logout(); },15*60*1000);
}
function startIdleWatch(){
  if(!_idleWatching){
    ["touchstart","mousedown","keydown","scroll","click"].forEach(e=>
      document.addEventListener(e,resetIdle,{passive:true}));
    _idleWatching=true;
  }
  resetIdle();
}

// ── Pull-to-refresh ──────────────────────────────────────────
function setupPullToRefresh(){
  let startY=0,pulling=false;
  document.addEventListener("touchstart",e=>{startY=e.touches[0].clientY;},{ passive:true});
  document.addEventListener("touchend",e=>{
    if(!pulling) return; pulling=false;
    const dy=e.changedTouches[0].clientY-startY;
    if(dy>90&&window.scrollY<=0) renderContent();
  },{passive:true});
  document.addEventListener("touchmove",e=>{
    if(window.scrollY<=0&&e.touches[0].clientY-startY>10) pulling=true;
  },{passive:true});
}

// ── Helpers ──────────────────────────────────────────────────
function fmtNum(n){ return Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2}); }
function fmtInput(v){
  const raw=v.replace(/,/g,"").replace(/[^0-9.]/g,"");
  const parts=raw.split(".");
  parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,",");
  return parts.length>1?parts[0]+"."+parts[1]:parts[0];
}
function parseAmount(v){ return parseFloat(String(v).replace(/,/g,"")||"0")||0; }
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g,c=>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ── Jalali helpers ───────────────────────────────────────────
function todayStr(){
  const d=new Date();
  if(window.jalaali){
    const j=jalaali.toJalaali(d.getFullYear(),d.getMonth()+1,d.getDate());
    return `${j.jy}-${String(j.jm).padStart(2,"0")}-${String(j.jd).padStart(2,"0")}`;
  }
  return d.toISOString().slice(0,10);
}
function currentMonthStr(){
  const d=new Date();
  if(window.jalaali){
    const j=jalaali.toJalaali(d.getFullYear(),d.getMonth()+1,d.getDate());
    return `${j.jy}-${String(j.jm).padStart(2,"0")}`;
  }
  return d.toISOString().slice(0,7);
}
function jalaliToGregorian(s){
  if(!window.jalaali||!s) return s;
  const p=s.split("-").map(Number); if(p.length!==3) return s;
  const g=jalaali.toGregorian(p[0],p[1],p[2]);
  return `${g.gy}-${String(g.gm).padStart(2,"0")}-${String(g.gd).padStart(2,"0")}`;
}
function gregorianToJalali(s){
  if(!window.jalaali||!s) return s;
  const p=s.split("-").map(Number); if(p.length!==3) return s;
  try{
    const j=jalaali.toJalaali(p[0],p[1],p[2]);
    return `${j.jy}/${String(j.jm).padStart(2,"0")}/${String(j.jd).padStart(2,"0")}`;
  }catch{return s;}
}
// Convert Gregorian YYYY-MM to Jalali YYYY-MM
function gregMonthToJalali(gm){
  if(!window.jalaali||!gm) return gm;
  try{
    const [y,m]=gm.split("-").map(Number);
    const j=jalaali.toJalaali(y,m,1);
    return `${j.jy}-${String(j.jm).padStart(2,"0")}`;
  }catch{return gm;}
}
// Convert Jalali YYYY-MM to Gregorian YYYY-MM
function jalaliMonthToGreg(jm){
  if(!window.jalaali||!jm) return jm;
  try{
    const [y,m]=jm.split("-").map(Number);
    const g=jalaali.toGregorian(y,m,1);
    return `${g.gy}-${String(g.gm).padStart(2,"0")}`;
  }catch{return jm;}
}
const JALALI_MONTHS=["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
function formatJalaliMonth(gm){
  if(!window.jalaali||!gm) return gm;
  try{
    const [y,m]=gm.split("-").map(Number);
    const j=jalaali.toJalaali(y,m,1);
    return `${JALALI_MONTHS[j.jm-1]} ${j.jy}`;
  }catch{return gm;}
}
function jalaliMonthLabel(jm){
  if(!jm) return jm;
  try{
    const [y,m]=jm.split("-").map(Number);
    return `${JALALI_MONTHS[m-1]} ${y}`;
  }catch{return jm;}
}
function formatDateTime(s){
  if(!s) return "";
  try{
    const iso=s.includes("T")?s:s.replace(" ","T")+"Z";
    return new Date(iso).toLocaleString("en-GB",{dateStyle:"short",timeStyle:"short"});
  }catch{return s;}
}
// Build a Jalali <input type="month"> value list for the last 24 months
function jalaliMonthOptions(selectedJm){
  const opts=[];
  const d=new Date();
  for(let i=0;i<24;i++){
    const dd=new Date(d.getFullYear(),d.getMonth()-i,1);
    if(window.jalaali){
      const j=jalaali.toJalaali(dd.getFullYear(),dd.getMonth()+1,1);
      const jm=`${j.jy}-${String(j.jm).padStart(2,"0")}`;
      opts.push(`<option value="${jm}" ${jm===selectedJm?"selected":""}>${jalaliMonthLabel(jm)}</option>`);
    }else{
      const gm=`${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,"0")}`;
      opts.push(`<option value="${gm}" ${gm===selectedJm?"selected":""}>${gm}</option>`);
    }
  }
  return opts.join("");
}

function showToast(msg,type=""){
  const t=document.getElementById("toast");
  t.textContent=msg; t.className="toast "+(type||"");
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.add("hidden"),3200);
}

async function apiFetch(path,opts={}){
  opts.headers=Object.assign(
    {"Content-Type":"application/json","Authorization":"Bearer "+state.token},
    opts.headers||{}
  );
  const res=await fetch(API_BASE+path,opts);
  if(res.status===401){logout();throw new Error("نشست منقضی شده");}
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.error) throw new Error(data.error||"خطا در ارتباط با سرور");
  return data;
}

// ── Auth ─────────────────────────────────────────────────────
function showLogin(){
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}
function showApp(){
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  const initial=(state.name||"?")[0].toUpperCase();
  document.querySelectorAll(".profile-avatar,.profile-avatar-lg").forEach(el=>el.textContent=initial);
  document.getElementById("user-name").textContent=state.name;
  document.getElementById("profile-name-lg").textContent=state.name;
  renderVesselBottomNav();
  renderSectionTabs();
  renderContent();
  startIdleWatch();
}
function logout(){
  clearTimeout(_idleTimer);
  _idleWatching=false;
  localStorage.removeItem("lc_token");
  localStorage.removeItem("lc_name");
  localStorage.removeItem("lc_admin");
  state.token=null; state.name=null; state.isAdmin=false;
  closeProfilePanel();
  showLogin();
}

// ── PIN pad ──────────────────────────────────────────────────
function setupPinPad(padId,displayId,onComplete){
  let localPin="";
  const dots=()=>document.querySelectorAll(`#${displayId} .pin-dot`);
  document.querySelectorAll(`#${padId} [data-digit]`).forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(localPin.length>=4) return;
      playClick();
      localPin+=btn.dataset.digit;
      dots().forEach((d,i)=>d.classList.toggle("filled",i<localPin.length));
      if(localPin.length===4){ const p=localPin; localPin=""; dots().forEach(d=>d.classList.remove("filled")); onComplete(p); }
    });
  });
  document.querySelector(`#${padId} [data-action="back"]`).addEventListener("click",()=>{
    playClick();
    localPin=localPin.slice(0,-1);
    dots().forEach((d,i)=>d.classList.toggle("filled",i<localPin.length));
  });
  document.querySelector(`#${padId} [data-action="clear"]`).addEventListener("click",()=>{
    playClick();
    localPin=""; dots().forEach(d=>d.classList.remove("filled"));
  });
}
function shakeCard(sel){
  const el=document.querySelector(sel); if(!el) return;
  el.classList.remove("shake");
  requestAnimationFrame(()=>el.classList.add("shake"));
  setTimeout(()=>el.classList.remove("shake"),450);
}
async function attemptLogin(password,onError){
  try{
    const res=await fetch(API_BASE+"/api/login",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({password}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.error) throw new Error(data.error||"رمز نامعتبر");
    state.token=data.token; state.name=data.name; state.isAdmin=!!data.isAdmin;
    localStorage.setItem("lc_token",state.token);
    localStorage.setItem("lc_name",state.name);
    localStorage.setItem("lc_admin",state.isAdmin?"1":"0");
    showApp();
  }catch(err){ if(onError) onError(err.message); }
}

// ── Profile panel ────────────────────────────────────────────
function openProfilePanel(){
  document.getElementById("profile-panel").classList.remove("hidden");
  document.getElementById("profile-overlay").classList.remove("hidden");
  document.getElementById("profile-arrow").classList.add("open");
}
function closeProfilePanel(){
  document.getElementById("profile-panel").classList.add("hidden");
  document.getElementById("profile-overlay").classList.add("hidden");
  document.getElementById("profile-arrow").classList.remove("open");
}

// ── Change PIN modal ─────────────────────────────────────────
let newPinStep=0,firstPin="";
function openChangePinModal(){
  closeProfilePanel(); newPinStep=0; firstPin="";
  document.querySelectorAll("#new-pin-display .pin-dot").forEach(d=>d.classList.remove("filled"));
  document.getElementById("new-pin-status").textContent="رمز جدید را وارد کنید";
  document.getElementById("modal-pin").classList.remove("hidden");
}
function closeChangePinModal(){ document.getElementById("modal-pin").classList.add("hidden"); newPinStep=0; firstPin=""; }

// ── Charterers modal ─────────────────────────────────────────
function openCharterersModal(){
  closeProfilePanel();
  document.getElementById("modal-charterers").classList.remove("hidden");
  loadCharterersList();
}
function closeCharterersModal(){ document.getElementById("modal-charterers").classList.add("hidden"); }
async function loadCharterersList(){
  const wrap=document.getElementById("charterers-list");
  wrap.innerHTML='<div style="color:var(--text-soft);font-size:13px;padding:8px;">در حال بارگذاری...</div>';
  try{
    const data=await apiFetch("/api/charterers");
    if(!data.charterers.length){ wrap.innerHTML='<div style="color:var(--text-soft);font-size:13px;padding:8px;">چارترکننده‌ای ثبت نشده است.</div>'; return; }
    wrap.innerHTML=data.charterers.map(c=>`
      <div class="charterer-row">
        <span class="c-name">${escapeHtml(c.name)}</span>
        <button class="btn btn-sm btn-danger" data-del-ch="${c.id}">حذف</button>
      </div>`).join("");
    wrap.querySelectorAll("[data-del-ch]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!confirm("حذف شود؟")) return;
      try{ await apiFetch(`/api/charterers/${btn.dataset.delCh}`,{method:"DELETE"}); await loadCharterersList(); showToast("حذف شد","success"); }
      catch(e){ showToast(e.message,"error"); }
    }));
  }catch(e){ wrap.innerHTML=`<div style="color:var(--red);font-size:13px;">${e.message}</div>`; }
}

// ── Navigation ───────────────────────────────────────────────
function renderVesselBottomNav(){
  const nav=document.getElementById("vessel-bottom-nav");
  nav.innerHTML=VESSELS.map(v=>`
    <button class="vessel-nav-btn ${v.key===state.vessel?"active":""}" data-vessel="${escapeHtml(v.key)}">
      <span class="vicon">${v.icon}</span>
      <span>${escapeHtml(v.label)}</span>
    </button>`).join("");
  nav.querySelectorAll("[data-vessel]").forEach(btn=>btn.addEventListener("click",()=>{
    playClick();
    state.vessel=btn.dataset.vessel;
    localStorage.setItem("lc_vessel",state.vessel);
    renderVesselBottomNav(); renderContent();
  }));
}
function renderSectionTabs(){
  const bar=document.getElementById("section-tabs");
  bar.innerHTML=SECTIONS.map(s=>`
    <button class="section-tab-btn ${s.key===state.section?"active":""}" data-section="${s.key}">${s.label}</button>`).join("");
  bar.querySelectorAll("[data-section]").forEach(btn=>btn.addEventListener("click",()=>{
    state.section=btn.dataset.section; renderSectionTabs(); renderContent();
    btn.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
  }));
}
function renderContent(){
  const sec=SECTIONS.find(s=>s.key===state.section); if(!sec) return;
  if(sec.type==="chart") renderChartSection();
  else if(sec.type==="statement") renderStatementSection();
  else if(sec.type==="trash") renderTrashSection();
  else if(sec.type==="shareholders") renderShareholdersSection();
  else renderTransactionsSection(sec.key);
}

// ── Rate ─────────────────────────────────────────────────────
async function loadRate(){
  try{ state.rate=await apiFetch("/api/rate"); }
  catch(e){ state.rate={rate:null,stale:true,error:e.message}; }
}
function adminRateControl(){
  if(!state.isAdmin) return "";
  return `<button class="btn btn-sm btn-ghost" id="edit-rate-btn">ویرایش نرخ</button>`;
}
function renderRateBanner(slotId){
  const slot=document.getElementById(slotId); if(!slot) return;
  const r=state.rate;
  if(!r||!r.rate){
    slot.innerHTML=`<div class="rate-banner stale"><div class="rate-main"><span>نرخ درهم در دسترس نیست</span></div><div class="rate-meta">${adminRateControl()}</div></div>`;
  }else{
    const staleFlag=r.stale?'<span class="rate-stale-flag">قدیمی</span>':"";
    slot.innerHTML=`<div class="rate-banner ${r.stale?"stale":""}">
      <div class="rate-main"><span>نرخ درهم:</span><span class="rate-value">${fmtNum(r.rate)} تومان</span>${staleFlag}</div>
      <div class="rate-meta">${r.fetched_at?formatDateTime(r.fetched_at):""}${adminRateControl()}</div></div>`;
  }
  const btn=slot.querySelector("#edit-rate-btn");
  if(btn) btn.addEventListener("click",async()=>{
    const val=prompt("نرخ جدید درهم به تومان:",r&&r.rate?Math.round(r.rate):""); if(!val) return;
    const num=Number(val);
    if(!isFinite(num)||num<=0){showToast("مقدار نامعتبر","error");return;}
    try{ await apiFetch("/api/rate",{method:"POST",body:JSON.stringify({rate:num})}); await loadRate(); renderContent(); showToast("نرخ بروزرسانی شد","success"); }
    catch(e){ showToast(e.message,"error"); }
  });
}

// ── Charterers ───────────────────────────────────────────────
async function fetchCharterers(){
  try{ const d=await apiFetch("/api/charterers"); return d.charterers||[]; }
  catch{ return []; }
}
function chartererSelectHtml(charterers,selectedId=""){
  return `<select id="f-charterer">
    <option value="">— بدون چارترکننده —</option>
    ${charterers.map(c=>`<option value="${c.id}" ${String(c.id)===String(selectedId)?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}
  </select>`;
}

// ── Transactions section ──────────────────────────────────────
async function renderTransactionsSection(category){
  const isIncome=category.startsWith("income");
  const content=document.getElementById("content");
  const charterers=isIncome?await fetchCharterers():[];
  content.innerHTML=`
    <div class="section-title"><h2>${CATEGORY_LABELS[category]}</h2></div>
    ${isIncome?'<div id="rate-banner-slot"></div>':""}
    <div id="summary-slot"></div>
    ${isIncome&&charterers.length?`<div class="charterer-filter">
      <label>فیلتر چارترکننده:</label>
      <select id="charterer-filter-sel">
        <option value="">همه</option>
        ${charterers.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
      </select></div>`:""}
    <div class="card">
      <h3>ثبت مورد جدید</h3>
      <div class="entry-form">
        <div class="form-field grow-2"><label>شرح</label><input type="text" id="f-desc" placeholder="توضیحات" /></div>
        <div class="form-field"><label>مبلغ</label><input type="text" id="f-amount" inputmode="numeric" placeholder="0" /></div>
        <div class="form-field"><label>ارز</label><select id="f-currency"><option value="IRR">تومان</option><option value="AED">درهم</option></select></div>
        ${isIncome?`<div class="form-field"><label>چارترکننده</label>${chartererSelectHtml(charterers)}</div>`:""}
        <div class="form-field"><label>تاریخ (شمسی)</label><input type="text" id="f-date" placeholder="${todayStr()}" dir="ltr" style="text-align:center;" /></div>
        <div class="form-actions"><button class="btn btn-primary" id="submit-tx-btn">ثبت</button></div>
      </div>
    </div>
    <div class="card">
      <h3>فهرست موارد</h3>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr>
            <th>تاریخ</th><th>شرح</th>
            ${isIncome?"<th>چارترکننده</th>":""}
            <th>مبلغ</th><th>ارز</th><th>ثبت‌کننده</th><th></th>
          </tr></thead>
          <tbody id="tx-tbody"><tr class="empty-row"><td colspan="${isIncome?7:6}">در حال بارگذاری...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  document.getElementById("f-date").value=todayStr();

  // Amount formatting — thousands separator on input
  const amtInput=document.getElementById("f-amount");
  amtInput.addEventListener("input",()=>{
    const pos=amtInput.selectionStart; const old=amtInput.value;
    amtInput.value=fmtInput(amtInput.value);
    const diff=amtInput.value.length-old.length;
    try{ amtInput.setSelectionRange(pos+diff,pos+diff); }catch{}
  });

  document.getElementById("submit-tx-btn").addEventListener("click",async()=>{
    const btn=document.getElementById("submit-tx-btn");
    const desc=document.getElementById("f-desc").value.trim();
    const amount=parseAmount(document.getElementById("f-amount").value);
    const currency=document.getElementById("f-currency").value;
    const jalaliDate=document.getElementById("f-date").value.trim();
    const entry_date=jalaliToGregorian(jalaliDate)||jalaliDate;
    const charterer_id=isIncome&&document.getElementById("f-charterer")?document.getElementById("f-charterer").value||null:null;
    if(!amount||!jalaliDate){showToast("مبلغ و تاریخ الزامی است","error");return;}
    btn.disabled=true;
    try{
      await apiFetch("/api/transactions",{method:"POST",
        body:JSON.stringify({vessel:state.vessel,category,description:desc,amount,currency,entry_date,charterer_id})});
      document.getElementById("f-desc").value="";
      document.getElementById("f-amount").value="";
      document.getElementById("f-date").value=todayStr();
      if(document.getElementById("f-charterer")) document.getElementById("f-charterer").value="";
      playConfirm();
      await loadTransactions(category,isIncome);
      showToast("ثبت شد","success");
    }catch(e){ showToast(e.message,"error"); }
    finally{ btn.disabled=false; }
  });

  const filterSel=document.getElementById("charterer-filter-sel");
  if(filterSel) filterSel.addEventListener("change",()=>loadTransactions(category,isIncome));
  if(isIncome){ await loadRate(); renderRateBanner("rate-banner-slot"); }
  await loadTransactions(category,isIncome);
}

async function loadTransactions(category,isIncome){
  const filterSel=document.getElementById("charterer-filter-sel");
  const chartererFilter=filterSel?filterSel.value:"";
  try{
    const data=await apiFetch(`/api/transactions?vessel=${encodeURIComponent(state.vessel)}&category=${encodeURIComponent(category)}`);
    let rows=data.transactions;
    if(chartererFilter) rows=rows.filter(r=>String(r.charterer_id)===chartererFilter);

    // For income_received: subtract from pending amounts per charterer
    if(category==="income_received"&&rows.length){
      const pendingData=await apiFetch(`/api/transactions?vessel=${encodeURIComponent(state.vessel)}&category=income_pending`);
      const pendingMap={};
      pendingData.transactions.forEach(p=>{
        const k=String(p.charterer_id||"no"); const cur=p.currency;
        if(!pendingMap[k]) pendingMap[k]={IRR:0,AED:0,name:p.charterer_name||"بدون نام"};
        pendingMap[k][cur]=(pendingMap[k][cur]||0)+p.amount;
      });
      const recMap={};
      rows.forEach(r=>{
        const k=String(r.charterer_id||"no"); const cur=r.currency;
        if(!recMap[k]) recMap[k]={IRR:0,AED:0,name:r.charterer_name||"بدون نام"};
        recMap[k][cur]=(recMap[k][cur]||0)+r.amount;
      });
      // Build remaining-debt summary
      const debtHtml=Object.keys(pendingMap).map(k=>{
        const rec=recMap[k]||{IRR:0,AED:0};
        const remIRR=(pendingMap[k].IRR||0)-(rec.IRR||0);
        const remAED=(pendingMap[k].AED||0)-(rec.AED||0);
        if(remIRR<=0&&remAED<=0) return "";
        return `<div class="debt-row"><strong>${escapeHtml(pendingMap[k].name)}</strong>:
          ${remIRR>0?`<span class="amount-cell irr">${fmtNum(remIRR)} تومان</span>`:""}
          ${remAED>0?`<span class="amount-cell aed">${fmtNum(remAED)} درهم</span>`:""}
          <span class="tag" style="background:#FFF3CD;color:#856404;border-color:#FFDDA1;">هنوز پرداخت نشده</span>
        </div>`;
      }).filter(Boolean).join("");
      if(debtHtml){
        const debtCard=document.createElement("div");
        debtCard.className="card";
        debtCard.innerHTML=`<h3>مانده بدهی چارترکنندگان</h3><div class="debt-list">${debtHtml}</div>`;
        document.getElementById("content").insertBefore(debtCard,document.querySelector("#content .card"));
      }
    }

    renderTxTable(rows,category,isIncome);
    renderSummary(rows,category);
  }catch(e){ showToast(e.message,"error"); }
}

function renderTxTable(rows,category,isIncome){
  const tbody=document.getElementById("tx-tbody"); if(!tbody) return;
  const cols=isIncome?7:6;
  if(!rows.length){ tbody.innerHTML=`<tr class="empty-row"><td colspan="${cols}">موردی ثبت نشده است</td></tr>`; return; }
  tbody.innerHTML=rows.map(r=>`
    <tr>
      <td>${gregorianToJalali(r.entry_date)}</td>
      <td class="desc">${escapeHtml(r.description)}</td>
      ${isIncome?`<td>${r.charterer_name?`<span class="tag-charterer">${escapeHtml(r.charterer_name)}</span>`:"—"}</td>`:""}
      <td class="amount-cell ${r.currency==="AED"?"aed":"irr"}">${fmtNum(r.amount)}</td>
      <td><span class="tag">${r.currency==="AED"?"درهم":"تومان"}</span></td>
      <td>${escapeHtml(r.recorded_by)}</td>
      <td>${r.recorded_by===state.name||state.isAdmin?`<button class="btn btn-sm btn-danger" data-del="${r.id}" title="انتقال به حذف شده‌ها">حذف</button>`:""}</td>
    </tr>`).join("");
  tbody.querySelectorAll("[data-del]").forEach(btn=>btn.addEventListener("click",()=>deleteTx(btn.dataset.del,category,isIncome)));
}

function renderSummary(rows,category){
  const sumIRR=rows.filter(r=>r.currency==="IRR").reduce((s,r)=>s+r.amount,0);
  const sumAED=rows.filter(r=>r.currency==="AED").reduce((s,r)=>s+r.amount,0);
  const rate=(state.rate&&state.rate.rate)||0;
  let extraHtml="";
  if(category.startsWith("income")&&rate){
    const equiv=sumIRR+sumAED*rate;
    extraHtml=`<div class="total-chip accent"><div class="tc-label">معادل کل</div><div class="tc-val">${fmtNum(equiv)} ت</div></div>`;
  }
  document.getElementById("summary-slot").innerHTML=`
    <div class="totals-bar">
      <div class="total-chip"><div class="tc-label">جمع تومان</div><div class="tc-val">${fmtNum(sumIRR)}</div></div>
      <div class="total-chip"><div class="tc-label">جمع درهم</div><div class="tc-val">${fmtNum(sumAED)}</div></div>
      ${extraHtml}
    </div>`;
}

async function deleteTx(id,category,isIncome){
  if(!confirm("این مورد به بخش حذف شده‌ها منتقل شود؟")) return;
  try{
    await apiFetch(`/api/transactions/${id}/trash`,{method:"POST"});
    await loadTransactions(category,isIncome);
    showToast("به حذف شده‌ها منتقل شد","success");
  }catch(e){ showToast(e.message,"error"); }
}

// ── Chart section ─────────────────────────────────────────────
async function renderChartSection(){
  const content=document.getElementById("content");
  content.innerHTML=`
    <div class="section-title"><h2>نمودار — ${escapeHtml(state.vessel)}</h2></div>
    <div id="rate-banner-slot"></div>
    <div class="card chart-card"><div class="chart-title">ماهانه به تومان</div><canvas id="chart-toman" height="220"></canvas></div>
    <div class="card chart-card"><div class="chart-title">ماهانه به درهم</div><canvas id="chart-aed" height="220"></canvas></div>`;
  await loadRate(); renderRateBanner("rate-banner-slot");
  try{
    const data=await apiFetch(`/api/summary?vessel=${encodeURIComponent(state.vessel)}`);
    renderBarChart("chart-toman",data.months,data.income_toman,data.expense_toman);
    renderBarChart("chart-aed",data.months,data.income_aed,data.expense_aed);
  }catch(e){ showToast(e.message,"error"); }
}
function renderBarChart(canvasId,months,income,expense){
  if(charts[canvasId]) charts[canvasId].destroy();
  const ctx=document.getElementById(canvasId).getContext("2d");
  const has=months&&months.length>0;
  charts[canvasId]=new Chart(ctx,{type:"bar",
    data:{labels:has?months.map(formatJalaliMonth):["—"],
      datasets:[{label:"درآمد",data:has?income:[0],backgroundColor:"#1E9E63",borderRadius:4},
                {label:"مخارج",data:has?expense:[0],backgroundColor:"#E0473C",borderRadius:4}]},
    options:{responsive:true,plugins:{legend:{position:"top"}},scales:{y:{beginAtZero:true,ticks:{callback:v=>fmtNum(v)}}}}});
}

// ── PDF helpers ───────────────────────────────────────────────
let _logoB64=null;
async function getLogoB64(){
  if(_logoB64) return _logoB64;
  try{
    const res=await fetch("/icon-192.png"); const blob=await res.blob();
    return new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=()=>{ _logoB64=reader.result; resolve(_logoB64); };
      reader.readAsDataURL(blob);
    });
  }catch{ return null; }
}
async function capturePdf(){
  const wrap=document.getElementById("pdf-capture-wrap");
  const el=document.getElementById("pdf-report");

  // Bring into view for html2canvas
  wrap.style.cssText="position:fixed;top:0;left:0;width:760px;opacity:1;z-index:-1000;pointer-events:none;overflow:visible;";
  await new Promise(r=>setTimeout(r,150));

  const canvas=await html2canvas(el,{
    scale:2,
    backgroundColor:"#ffffff",
    useCORS:true,
    logging:false,
    width:760,
    scrollX:0,
    scrollY:0,
  });

  // Hide again
  wrap.style.cssText="position:fixed;top:-99999px;left:0;width:760px;opacity:0;pointer-events:none;z-index:-1;";

  const imgData=canvas.toDataURL("image/png");
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF("p","mm","a4");
  const pw=pdf.internal.pageSize.getWidth();
  const ph=pdf.internal.pageSize.getHeight();
  const ih=(canvas.height*pw)/canvas.width;
  let left=ih, pos=0;
  pdf.addImage(imgData,"PNG",0,pos,pw,ih); left-=ph;
  while(left>0){ pos-=ph; pdf.addPage(); pdf.addImage(imgData,"PNG",0,pos,pw,ih); left-=ph; }
  return pdf;
}
async function downloadReport(id,month,kind){
  try{
    const res=await fetch(API_BASE+`/api/${kind}/${id}`,{headers:{"Authorization":"Bearer "+state.token}});
    if(!res.ok) throw new Error("خطا در دانلود");
    const blob=await res.blob(); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url;
    a.download=`${state.vessel.replace(/\s+/g,"-")}-${month}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ showToast(e.message,"error"); }
}

// ── Statement section ─────────────────────────────────────────
function computeStatementRows(data){
  const rate=(state.rate&&state.rate.rate)||0;
  return data.months.map((month,i)=>({
    month,
    incomeToman:data.income_received_irr[i]+data.income_received_aed[i]*rate,
    expenseToman:data.expense_irr[i]+data.expense_aed[i]*rate,
    get net(){ return this.incomeToman-this.expenseToman; },
  }));
}

async function renderStatementSection(){
  const content=document.getElementById("content");
  const partners=PARTNERS[state.vessel]||PARTNERS_OTHER;
  const curJMonth=currentMonthStr();

  content.innerHTML=`
    <div class="section-title"><h2>صورت‌حساب ماهانه — ${escapeHtml(state.vessel)}</h2></div>
    <div id="rate-banner-slot"></div>
    <div class="card">
      <h3>خلاصه همه ماه‌ها و سهم شرکاء</h3>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr>
            <th>ماه</th><th>درآمد</th><th>مخارج</th><th>سود/زیان</th>
            ${partners.map(p=>`<th>${escapeHtml(p.name)}<br/><small>${p.dang}د</small></th>`).join("")}
            <th>وضعیت</th>
          </tr></thead>
          <tbody id="statement-tbody">
            <tr class="empty-row"><td colspan="${5+partners.length}">در حال بارگذاری...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="card" id="generate-card">
      <h3>ساخت گزارش PDF ماهانه</h3>
      <p style="font-size:12px;color:var(--text-soft);margin:0 0 10px;">فقط ماه‌هایی که تأیید شده‌اند قابل صدور PDF هستند.</p>
      <div class="entry-form" style="margin-bottom:12px;">
        <div class="form-field">
          <label>انتخاب ماه (شمسی)</label>
          <select id="statement-month">${jalaliMonthOptions(curJMonth)}</select>
        </div>
        <div class="form-actions stmt-actions">
          <button class="btn btn-secondary" id="close-month-btn">تأیید و بستن ماه</button>
          <button class="btn btn-primary" id="gen-statement-btn">دانلود PDF</button>
        </div>
      </div>
      <div id="statement-report-list" class="report-list"><p style="color:var(--text-soft);font-size:13px;">در حال بارگذاری...</p></div>
    </div>`;

  await loadRate(); renderRateBanner("rate-banner-slot");
  await loadStatementTable();
  await loadStatementReportsList();

  document.getElementById("close-month-btn").addEventListener("click",onCloseMonth);
  document.getElementById("gen-statement-btn").addEventListener("click",onGenerateStatementPdf);
}

async function loadStatementTable(){
  const tbody=document.getElementById("statement-tbody"); if(!tbody) return;
  const partners=PARTNERS[state.vessel]||PARTNERS_OTHER;
  try{
    const [stmtData,closedData]=await Promise.all([
      apiFetch(`/api/statements?vessel=${encodeURIComponent(state.vessel)}`),
      apiFetch(`/api/statement-report/list?vessel=${encodeURIComponent(state.vessel)}`),
    ]);
    const closedMonths=new Set((closedData.reports||[]).map(r=>r.month)); // Gregorian months that are closed
    if(!stmtData.months.length){
      tbody.innerHTML=`<tr class="empty-row"><td colspan="${5+partners.length}">داده‌ای ثبت نشده است</td></tr>`;
      return;
    }
    const rows=computeStatementRows(stmtData).reverse();
    tbody.innerHTML=rows.map(r=>{
      const isClosed=closedMonths.has(r.month);
      return `<tr>
        <td>${formatJalaliMonth(r.month)}</td>
        <td class="amount-cell irr">${fmtNum(r.incomeToman)}</td>
        <td class="amount-cell irr">${fmtNum(r.expenseToman)}</td>
        <td class="amount-cell ${r.net<0?"negative":"positive"}">${fmtNum(r.net)}</td>
        ${partners.map(p=>`<td>${fmtNum(r.net*(p.dang/6))}</td>`).join("")}
        <td>${isClosed?'<span class="tag" style="background:#D4EDDA;color:#155724;border-color:#C3E6CB;">✓ بسته شده</span>':'<span class="tag" style="background:#FFF3CD;color:#856404;border-color:#FFDDA1;">باز</span>'}</td>
      </tr>`;
    }).join("");
  }catch(e){
    tbody.innerHTML=`<tr class="empty-row"><td colspan="${5+PARTNERS[state.vessel].length}">خطا</td></tr>`;
    showToast(e.message,"error");
  }
}

async function onCloseMonth(){
  const jMonth=document.getElementById("statement-month").value;
  if(!jMonth){showToast("ماه را انتخاب کنید","error");return;}

  const gregMonth=jalaliMonthToGreg(jMonth);
  // Check if already closed
  const listData=await apiFetch(`/api/statement-report/list?vessel=${encodeURIComponent(state.vessel)}`);
  const alreadyClosed=(listData.reports||[]).some(r=>r.month===gregMonth);
  if(alreadyClosed){
    if(!confirm(`ماه ${jalaliMonthLabel(jMonth)} قبلاً بسته شده است.\nآیا می‌خواهید دوباره PDF صادر و جایگزین شود؟`)) return;
  }else{
    if(!confirm(`آیا مطمئنید می‌خواهید ماه ${jalaliMonthLabel(jMonth)} را ببندید؟\n\nبعد از تأیید:\n• PDF صورت‌حساب کامل صادر می‌شود\n• در بایگانی ذخیره می‌شود\n• ماه به‌عنوان «بسته شده» علامت می‌خورد`)) return;
  }

  const btn=document.getElementById("close-month-btn");
  btn.disabled=true; btn.textContent="در حال پردازش...";
  try{ await generateAndSaveStatementPdf(jMonth,true); }
  catch(e){ showToast(e.message,"error"); }
  finally{ btn.disabled=false; btn.textContent="تأیید و بستن ماه"; }
}

async function onGenerateStatementPdf(){
  const jMonth=document.getElementById("statement-month").value;
  if(!jMonth){showToast("ماه را انتخاب کنید","error");return;}
  if(!confirm(`دانلود PDF صورت‌حساب ماه ${jalaliMonthLabel(jMonth)}؟`)) return;
  const btn=document.getElementById("gen-statement-btn");
  btn.disabled=true; btn.textContent="در حال ساخت...";
  try{ await generateAndSaveStatementPdf(jMonth,false); }
  catch(e){ showToast(e.message,"error"); }
  finally{ btn.disabled=false; btn.textContent="دانلود PDF"; }
}

async function generateAndSaveStatementPdf(jMonth, archive=false){
  const gregMonth=jalaliMonthToGreg(jMonth);
  const partners=PARTNERS[state.vessel]||PARTNERS_OTHER;
  const [allTx,stmtData,logoB64,shData]=await Promise.all([
    apiFetch(`/api/transactions?vessel=${encodeURIComponent(state.vessel)}`),
    apiFetch(`/api/statements?vessel=${encodeURIComponent(state.vessel)}`),
    getLogoB64(),
    apiFetch(`/api/shareholder-tx?vessel=${encodeURIComponent(state.vessel)}`),
  ]);
  const monthTx=allTx.transactions.filter(t=>{
    // Convert each transaction's Gregorian date to Jalali month and compare
    if(!t.entry_date) return false;
    try{
      const parts=t.entry_date.split("-").map(Number);
      if(window.jalaali&&parts.length===3){
        const j=jalaali.toJalaali(parts[0],parts[1],parts[2]);
        const txJMonth=`${j.jy}-${String(j.jm).padStart(2,"0")}`;
        return txJMonth===jMonth;
      }
      // Fallback: compare gregorian prefix
      return t.entry_date.startsWith(gregMonth);
    }catch{ return false; }
  });
  const stmtRows=computeStatementRows(stmtData);
  // stmtData.months are Gregorian — find matching month
  let idx=stmtData.months.indexOf(gregMonth);
  // If not found, try all possible Gregorian months that overlap with this Jalali month
  if(idx===-1){
    for(let m=0;m<stmtData.months.length;m++){
      const gm=stmtData.months[m];
      if(!gm) continue;
      const gmParts=gm.split("-").map(Number);
      if(window.jalaali&&gmParts.length===2){
        try{
          const j=jalaali.toJalaali(gmParts[0],gmParts[1],1);
          const jMStr=`${j.jy}-${String(j.jm).padStart(2,"0")}`;
          if(jMStr===jMonth){idx=m;break;}
        }catch{}
      }
    }
  }
  const stmtRow=idx===-1?{month:gregMonth,incomeToman:0,expenseToman:0,net:0}:stmtRows[idx];

  await generatePdfDoc(state.vessel, jMonth, gregMonth, monthTx, stmtRow, partners, logoB64, archive, shData.transactions||[]);
}

async function generatePdfDoc(vessel, jMonth, gregMonth, rows, stmtRow, partners, logoB64, archive, shTxRows=[]){
  const by={general_expense:[],salary:[],income_received:[],income_pending:[]};
  rows.forEach(r=>{ if(by[r.category]) by[r.category].push(r); });
  const sumBy=(list,cur)=>list.filter(r=>r.currency===cur).reduce((s,r)=>s+r.amount,0);
  const tGIRR=sumBy(by.general_expense,"IRR"), tGAED=sumBy(by.general_expense,"AED");
  const tSIRR=sumBy(by.salary,"IRR"),           tSAED=sumBy(by.salary,"AED");
  const tRIRR=sumBy(by.income_received,"IRR"),  tRAED=sumBy(by.income_received,"AED");
  const tPIRR=sumBy(by.income_pending,"IRR"),   tPAED=sumBy(by.income_pending,"AED");
  const rate=(state.rate&&state.rate.rate)||0;

  const logoHtml = logoB64
    ? `<img src="${logoB64}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;vertical-align:middle;">`
    : `<div style="width:52px;height:52px;border-radius:10px;background:#FF8A1E;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:800;">ا</div>`;

  const headerHtml = `
    <div style="display:flex;align-items:center;gap:14px;padding-bottom:10px;border-bottom:3px solid #FF8A1E;margin-bottom:14px;">
      ${logoHtml}
      <div>
        <div style="font-size:18px;font-weight:800;color:#0E2A47;">ابرکاوان — LCT Fleet</div>
        <div style="font-size:11px;color:#5C6B7E;margin-top:2px;">
          شناور: <b>${escapeHtml(vessel)}</b> &nbsp;|&nbsp;
          ماه: <b>${jalaliMonthLabel(jMonth)}</b> &nbsp;|&nbsp;
          تاریخ صدور: <b>${todayStr()}</b>
          ${rate?` &nbsp;|&nbsp; نرخ درهم: <b style="color:#FF8A1E;">${fmtNum(rate)} تومان</b>`:""}
        </div>
      </div>
    </div>`;

  const summaryHtml = `
    <div style="margin-bottom:14px;">
      <div style="background:#0E2A47;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:8px;">خلاصه مالی ماه</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${[
          ["مخارج عمومی",     `${fmtNum(tGIRR)} ت / ${fmtNum(tGAED)} د`],
          ["حقوق و مزایا",    `${fmtNum(tSIRR)} ت / ${fmtNum(tSAED)} د`],
          ["جمع مخارج",       `${fmtNum(tGIRR+tSIRR)} ت / ${fmtNum(tGAED+tSAED)} د`],
          ["درآمد وصول‌شده",  `${fmtNum(tRIRR)} ت / ${fmtNum(tRAED)} د`],
          ["درآمد وصول‌نشده", `${fmtNum(tPIRR)} ت / ${fmtNum(tPAED)} د`],
          ["سود/زیان خالص",   `${fmtNum(stmtRow.net)} تومان`,"#1E9E63"],
        ].map(([l,v,c])=>`
          <div style="background:#F4F6FA;border-radius:6px;padding:7px 9px;">
            <div style="font-size:9px;color:#5C6B7E;">${l}</div>
            <div style="font-size:11px;font-weight:700;color:${c||"#0E2A47"};margin-top:3px;">${v}</div>
          </div>`).join("")}
      </div>
    </div>`;

  const partnersHtml = `
    <div style="margin-bottom:14px;">
      <div style="background:#0E2A47;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:8px;">سهم شرکاء (از ۶ دانگ)</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr>
          <th style="background:#FF8A1E;color:#fff;padding:5px 8px;text-align:right;">شریک</th>
          <th style="background:#FF8A1E;color:#fff;padding:5px 8px;text-align:right;">دانگ</th>
          <th style="background:#FF8A1E;color:#fff;padding:5px 8px;text-align:right;">سهم از سود/زیان (تومان)</th>
        </tr></thead>
        <tbody>${partners.map((p,i)=>`
          <tr style="background:${i%2?"#FFF8F0":"#fff"};">
            <td style="padding:5px 8px;border-bottom:1px solid #E1E6EE;">${escapeHtml(p.name)}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #E1E6EE;">${p.dang}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #E1E6EE;font-weight:700;">${fmtNum(stmtRow.net*(p.dang/6))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  const txSecHtml = (title, list, showCharterer) => `
    <div style="margin-bottom:14px;">
      <div style="background:#16395E;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:8px;">${title}</div>
      ${list.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr>
          <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">تاریخ</th>
          <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">شرح</th>
          ${showCharterer?`<th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">چارترکننده</th>`:""}
          <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">مبلغ</th>
          <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">ارز</th>
          <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">ثبت‌کننده</th>
        </tr></thead>
        <tbody>${list.map((r,i)=>`
          <tr style="background:${i%2?"#F4F6FA":"#fff"};">
            <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${gregorianToJalali(r.entry_date)}</td>
            <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${escapeHtml(r.description||"")}</td>
            ${showCharterer?`<td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${escapeHtml(r.charterer_name||"—")}</td>`:""}
            <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;font-weight:700;">${fmtNum(r.amount)}</td>
            <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${r.currency==="AED"?"درهم":"تومان"}</td>
            <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${escapeHtml(r.recorded_by||"")}</td>
          </tr>`).join("")}
        </tbody>
        <tfoot><tr>
          <td colspan="${showCharterer?6:5}" style="padding:5px 8px;background:#F4F6FA;font-weight:700;font-size:11px;text-align:right;">
            جمع: ${fmtNum(sumBy(list,"IRR"))} تومان &nbsp;|&nbsp; ${fmtNum(sumBy(list,"AED"))} درهم
          </td>
        </tr></tfoot>
      </table>` : `<p style="color:#5C6B7E;font-size:11px;margin:0 0 0 8px;">موردی ثبت نشده است</p>`}
    </div>`;

  const footerHtml = `
    <div style="margin-top:16px;padding-top:8px;border-top:1px solid #E1E6EE;display:flex;justify-content:space-between;font-size:10px;color:#5C6B7E;">
      <span>صادرشده توسط: ${escapeHtml(state.name)} — ${new Date().toLocaleString("fa-IR")}</span>
      <span style="color:#FF8A1E;font-weight:700;">Abarkavan LCT Fleet</span>
    </div>`;

  // Shareholder section for PDF
  const shSectionHtml = (()=>{
    // Filter to only this month's shareholder transactions
    const shMonth = shTxRows.filter(r=>{
      if(!r.entry_date) return false;
      try{
        const p=r.entry_date.split("-").map(Number);
        if(window.jalaali&&p.length===3){
          const j=jalaali.toJalaali(p[0],p[1],p[2]);
          return `${j.jy}-${String(j.jm).padStart(2,"0")}`===jMonth;
        }
        return r.entry_date.startsWith(gregMonth);
      }catch{return false;}
    });
    if(!shMonth.length) return "";

    const rows = shMonth.map((r,i)=>`
      <tr style="background:${i%2?"#F4F6FA":"#fff"};">
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${gregorianToJalali(r.entry_date)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;font-weight:600;">${escapeHtml(r.partner_name)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;color:${r.type==="withdrawal"?"#E0473C":r.type==="debt"?"#234A75":"#1E9E63"};font-weight:600;">${TX_TYPE_LABELS[r.type]||r.type}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${escapeHtml(r.description||"")}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;font-weight:700;">${fmtNum(r.amount)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${r.currency==="AED"?"درهم":"تومان"}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #E1E6EE;">${r.settled?'<span style="color:#1E9E63;font-weight:700;">✓ تسویه</span>':'<span style="color:#E0473C;">باز</span>'}</td>
      </tr>`).join("");

    return `
      <div style="margin-bottom:14px;">
        <div style="background:#0E2A47;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:8px;">تراکنش‌های سهامداران</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">تاریخ</th>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">سهامدار</th>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">نوع</th>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">توضیح</th>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">مبلغ</th>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">ارز</th>
            <th style="background:#234A75;color:#fff;padding:4px 6px;text-align:right;">وضعیت</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  })();

  // Build full HTML in the hidden pdf-report div
  const el = document.getElementById("pdf-report");
  el.innerHTML = headerHtml + summaryHtml + partnersHtml
    + txSecHtml("مخارج عمومی", by.general_expense, false)
    + txSecHtml("حقوق و مزایا پرسنل", by.salary, false)
    + txSecHtml("درآمد وصول‌شده", by.income_received, true)
    + txSecHtml("درآمد وصول‌نشده", by.income_pending, true)
    + shSectionHtml
    + footerHtml;

  // Show element for capture
  const wrap = document.getElementById("pdf-capture-wrap");
  wrap.style.cssText = "position:fixed;top:0;left:0;width:794px;opacity:1;z-index:-1000;pointer-events:none;";
  await new Promise(r=>setTimeout(r,200));

  // A4 at 96dpi: 794px wide, 1123px tall per page
  const A4W = 794, A4H = 1123;
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    width: A4W,
    scrollX: 0, scrollY: 0,
  });

  // Hide again
  wrap.style.cssText = "position:fixed;top:-99999px;left:0;width:760px;opacity:0;pointer-events:none;z-index:-1;";

  const {jsPDF} = window.jspdf;
  const pdf = new jsPDF({orientation:"portrait", unit:"px", format:"a4", hotfixes:["px_scaling"]});
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  // Split canvas into A4 pages
  const totalPagesNeeded = Math.ceil(canvas.height / (canvas.width * (pdfH/pdfW)));
  const sliceH = Math.floor(canvas.width * (pdfH/pdfW));

  for(let page=0; page<totalPagesNeeded; page++){
    if(page>0) pdf.addPage();
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = Math.min(sliceH, canvas.height - page*sliceH);
    const ctx = pageCanvas.getContext("2d");
    ctx.drawImage(canvas, 0, -page*sliceH);
    const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pageCanvas.height*(pdfW/canvas.width));
  }

  pdf.save(`${vessel.replace(/\s+/g,"-")}-${jMonth}.pdf`);

  if(archive){
    const base64 = pdf.output("datauristring");
    await apiFetch("/api/statement-report",{method:"POST",
      body:JSON.stringify({vessel, month:gregMonth, pdf_base64:base64})});
    playConfirm();
    await loadStatementTable();
    await loadStatementReportsList();
    showToast(`ماه ${jalaliMonthLabel(jMonth)} بسته و بایگانی شد`,"success");
  }else{
    showToast("PDF دانلود شد","success");
  }
}

async function loadStatementReportsList(){
  const wrap=document.getElementById("statement-report-list"); if(!wrap) return;
  try{
    const data=await apiFetch(`/api/statement-report/list?vessel=${encodeURIComponent(state.vessel)}`);
    if(!data.reports.length){wrap.innerHTML='<p style="color:var(--text-soft);font-size:13px;">گزارشی بایگانی نشده است.</p>';return;}
    wrap.innerHTML=`<h4 style="margin:0 0 8px;font-size:13px;color:var(--text-soft);">گزارش‌های بایگانی‌شده:</h4>`+
      data.reports.map(r=>`
        <div class="report-row">
          <div class="meta"><strong>${formatJalaliMonth(r.month)}</strong>
            <small>${escapeHtml(r.created_by||"")} — ${formatDateTime(r.created_at)}</small></div>
          <div class="report-actions">
            <button class="btn btn-sm btn-outline" data-dl-s="${r.id}" data-month="${r.month}">دانلود</button>
            ${state.isAdmin?`<button class="btn btn-sm btn-danger" data-del-s="${r.id}">حذف</button>`:""}
          </div>
        </div>`).join("");
    wrap.querySelectorAll("[data-dl-s]").forEach(b=>b.addEventListener("click",()=>downloadReport(b.dataset.dlS,b.dataset.month,"statement-report")));
    wrap.querySelectorAll("[data-del-s]").forEach(b=>b.addEventListener("click",async()=>{
      if(!confirm("حذف شود؟")) return;
      try{ await apiFetch(`/api/statement-report/${b.dataset.delS}`,{method:"DELETE"}); await loadStatementReportsList(); await loadStatementTable(); showToast("حذف شد","success"); }
      catch(e){ showToast(e.message,"error"); }
    }));
  }catch(e){ wrap.innerHTML='<p style="color:var(--red);font-size:13px;">خطا</p>'; }
}

// ── Trash section ─────────────────────────────────────────────
async function renderTrashSection(){
  const content=document.getElementById("content");
  content.innerHTML=`
    <div class="section-title">
      <h2>حذف شده‌ها — ${escapeHtml(state.vessel)}</h2>
      ${state.isAdmin?'<button class="btn btn-sm btn-danger" id="empty-trash-btn">پاک کردن همه</button>':""}
    </div>
    <div class="card">
      <h3>تراکنش‌های حذف‌شده</h3>
      <p style="font-size:12px;color:var(--text-soft);margin:0 0 10px;">می‌توانید موارد را بازیابی کنید یا برای همیشه حذف کنید.</p>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr><th>تاریخ</th><th>بخش</th><th>شرح</th><th>مبلغ</th><th>ارز</th><th>ثبت‌کننده</th><th></th></tr></thead>
          <tbody id="trash-tbody"><tr class="empty-row"><td colspan="7">در حال بارگذاری...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  if(state.isAdmin){
    document.getElementById("empty-trash-btn").addEventListener("click",async()=>{
      if(!confirm("همه موارد سطل آشغال برای همیشه حذف شوند؟")) return;
      try{
        await apiFetch(`/api/trash/empty?vessel=${encodeURIComponent(state.vessel)}`,{method:"DELETE"});
        await loadTrash();
        showToast("همه حذف شده‌ها پاک شدند","success");
      }catch(e){ showToast(e.message,"error"); }
    });
  }
  await loadTrash();
}

async function loadTrash(){
  const tbody=document.getElementById("trash-tbody"); if(!tbody) return;
  try{
    const data=await apiFetch(`/api/trash?vessel=${encodeURIComponent(state.vessel)}`);
    if(!data.transactions.length){
      tbody.innerHTML='<tr class="empty-row"><td colspan="7">سطل آشغال خالی است</td></tr>';
      return;
    }
    tbody.innerHTML=data.transactions.map(r=>`
      <tr style="opacity:.75;">
        <td>${gregorianToJalali(r.entry_date)}</td>
        <td><span class="tag">${CATEGORY_LABELS[r.category]||r.category}</span></td>
        <td class="desc">${escapeHtml(r.description)}</td>
        <td class="amount-cell ${r.currency==="AED"?"aed":"irr"}">${fmtNum(r.amount)}</td>
        <td><span class="tag">${r.currency==="AED"?"درهم":"تومان"}</span></td>
        <td>${escapeHtml(r.recorded_by)}</td>
        <td style="display:flex;gap:4px;">
          <button class="btn btn-sm btn-outline" data-restore="${r.id}" title="بازیابی">↩</button>
          ${state.isAdmin?`<button class="btn btn-sm btn-trash" data-perm-del="${r.id}" title="حذف دائم">🗑</button>`:""}
        </td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-restore]").forEach(btn=>btn.addEventListener("click",async()=>{
      try{
        await apiFetch(`/api/trash/${btn.dataset.restore}/restore`,{method:"POST"});
        await loadTrash(); showToast("بازیابی شد","success");
      }catch(e){ showToast(e.message,"error"); }
    }));
    tbody.querySelectorAll("[data-perm-del]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!confirm("این مورد برای همیشه حذف شود؟")) return;
      try{
        await apiFetch(`/api/trash/${btn.dataset.permDel}`,{method:"DELETE"});
        await loadTrash(); showToast("حذف دائم شد","success");
      }catch(e){ showToast(e.message,"error"); }
    }));
  }catch(e){ tbody.innerHTML=`<tr class="empty-row"><td colspan="7">خطا: ${e.message}</td></tr>`; }
}

// ── Shareholders section ──────────────────────────────────────
const TX_TYPE_LABELS = {
  withdrawal: "برداشت از سهم",
  debt:       "طلب از شرکت",
  settlement: "تسویه",
};
const TX_TYPE_COLORS = {
  withdrawal: "var(--red)",
  debt:       "var(--navy-600)",
  settlement: "var(--green)",
};

async function renderShareholdersSection(){
  const content = document.getElementById("content");
  const partners = PARTNERS[state.vessel] || PARTNERS_OTHER;

  content.innerHTML = `
    <div class="section-title"><h2>سهامداران — ${escapeHtml(state.vessel)}</h2></div>
    <div id="sh-summary-slot"></div>

    <div class="card">
      <h3>ثبت تراکنش سهامدار</h3>
      <div class="entry-form">
        <div class="form-field">
          <label>سهامدار</label>
          <select id="sh-partner">
            ${partners.map(p=>`<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label>نوع</label>
          <select id="sh-type">
            <option value="withdrawal">برداشت از سهم</option>
            <option value="debt">طلب از شرکت</option>
            <option value="settlement">تسویه</option>
          </select>
        </div>
        <div class="form-field">
          <label>مبلغ</label>
          <input type="text" id="sh-amount" inputmode="numeric" placeholder="0" />
        </div>
        <div class="form-field">
          <label>ارز</label>
          <select id="sh-currency">
            <option value="IRR">تومان</option>
            <option value="AED">درهم</option>
          </select>
        </div>
        <div class="form-field grow-2">
          <label>توضیح</label>
          <input type="text" id="sh-desc" placeholder="اختیاری" />
        </div>
        <div class="form-field">
          <label>تاریخ (شمسی)</label>
          <input type="text" id="sh-date" dir="ltr" style="text-align:center;" />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="sh-submit-btn">ثبت</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>فهرست تراکنش‌ها</h3>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr>
            <th>تاریخ</th><th>سهامدار</th><th>نوع</th><th>توضیح</th>
            <th>مبلغ</th><th>ارز</th><th>وضعیت</th><th>ثبت‌کننده</th><th></th>
          </tr></thead>
          <tbody id="sh-tbody">
            <tr class="empty-row"><td colspan="9">در حال بارگذاری...</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById("sh-date").value = todayStr();

  // Amount formatting
  const amtInput = document.getElementById("sh-amount");
  amtInput.addEventListener("input", ()=>{ amtInput.value = fmtInput(amtInput.value); });

  document.getElementById("sh-submit-btn").addEventListener("click", async ()=>{
    const btn = document.getElementById("sh-submit-btn");
    const partner_name = document.getElementById("sh-partner").value;
    const type = document.getElementById("sh-type").value;
    const amount = parseAmount(document.getElementById("sh-amount").value);
    const currency = document.getElementById("sh-currency").value;
    const description = document.getElementById("sh-desc").value.trim();
    const jalaliDate = document.getElementById("sh-date").value.trim();
    const entry_date = jalaliToGregorian(jalaliDate) || jalaliDate;

    if(!amount || !jalaliDate){ showToast("مبلغ و تاریخ الزامی است","error"); return; }
    btn.disabled = true;
    try{
      await apiFetch("/api/shareholder-tx", {method:"POST",
        body:JSON.stringify({vessel:state.vessel, partner_name, type, amount, currency, description, entry_date})});
      document.getElementById("sh-amount").value = "";
      document.getElementById("sh-desc").value = "";
      document.getElementById("sh-date").value = todayStr();
      playConfirm();
      await loadShareholderTx();
      showToast("ثبت شد","success");
    }catch(e){ showToast(e.message,"error"); }
    finally{ btn.disabled = false; }
  });

  await loadShareholderTx();
}

async function loadShareholderTx(){
  try{
    const data = await apiFetch(`/api/shareholder-tx?vessel=${encodeURIComponent(state.vessel)}`);
    renderShareholderSummary(data.transactions);
    renderShareholderTable(data.transactions);
  }catch(e){ showToast(e.message,"error"); }
}

function renderShareholderSummary(rows){
  const partners = PARTNERS[state.vessel] || PARTNERS_OTHER;
  const slot = document.getElementById("sh-summary-slot"); if(!slot) return;

  const cards = partners.map(p=>{
    const myRows = rows.filter(r=>r.partner_name===p.name && !r.settled);
    const withdrawIRR = myRows.filter(r=>r.type==="withdrawal"&&r.currency==="IRR").reduce((s,r)=>s+r.amount,0);
    const withdrawAED = myRows.filter(r=>r.type==="withdrawal"&&r.currency==="AED").reduce((s,r)=>s+r.amount,0);
    const debtIRR    = myRows.filter(r=>r.type==="debt"&&r.currency==="IRR").reduce((s,r)=>s+r.amount,0);
    const debtAED    = myRows.filter(r=>r.type==="debt"&&r.currency==="AED").reduce((s,r)=>s+r.amount,0);

    const hasBalance = withdrawIRR||withdrawAED||debtIRR||debtAED;
    return `
      <div class="summary-chip ${hasBalance?"accent":""}">
        <div class="label">${escapeHtml(p.name)} — ${p.dang} دانگ</div>
        ${withdrawIRR||withdrawAED?`<div style="font-size:12px;color:var(--red);margin-top:3px;">برداشت: ${withdrawIRR?fmtNum(withdrawIRR)+" ت":""} ${withdrawAED?fmtNum(withdrawAED)+" د":""}</div>`:""}
        ${debtIRR||debtAED?`<div style="font-size:12px;color:var(--navy-600);margin-top:2px;">طلب: ${debtIRR?fmtNum(debtIRR)+" ت":""} ${debtAED?fmtNum(debtAED)+" د":""}</div>`:""}
        ${!hasBalance?`<div style="font-size:12px;color:var(--green);margin-top:3px;">✓ تسویه</div>`:""}
      </div>`;
  }).join("");

  slot.innerHTML = `<div class="summary-row" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">${cards}</div>`;
}

function renderShareholderTable(rows){
  const tbody = document.getElementById("sh-tbody"); if(!tbody) return;
  if(!rows.length){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">موردی ثبت نشده است</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r=>`
    <tr style="${r.settled?"opacity:.6;":""}">
      <td>${gregorianToJalali(r.entry_date)}</td>
      <td><strong>${escapeHtml(r.partner_name)}</strong></td>
      <td><span style="color:${TX_TYPE_COLORS[r.type]||"inherit"};font-weight:600;font-size:12px;">${TX_TYPE_LABELS[r.type]||r.type}</span></td>
      <td class="desc">${escapeHtml(r.description||"")}</td>
      <td class="amount-cell ${r.currency==="AED"?"aed":"irr"}">${fmtNum(r.amount)}</td>
      <td><span class="tag">${r.currency==="AED"?"درهم":"تومان"}</span></td>
      <td>${r.settled
        ? `<span class="tag" style="background:#D4EDDA;color:#155724;border-color:#C3E6CB;">✓ تسویه شده</span>`
        : `<button class="btn btn-sm" style="background:#E8F5E9;color:#1E9E63;border:1px solid #A5D6A7;" data-settle="${r.id}">تسویه</button>`
      }</td>
      <td>${escapeHtml(r.recorded_by)}</td>
      <td>${state.isAdmin?`<button class="btn btn-sm btn-danger" data-sh-del="${r.id}">حذف</button>`:""}</td>
    </tr>`).join("");

  tbody.querySelectorAll("[data-settle]").forEach(btn=>btn.addEventListener("click", async()=>{
    if(!confirm("این مورد تسویه شده علامت شود؟")) return;
    try{
      await apiFetch(`/api/shareholder-tx/${btn.dataset.settle}/settle`,{method:"POST"});
      playConfirm();
      await loadShareholderTx();
      showToast("تسویه انجام شد","success");
    }catch(e){ showToast(e.message,"error"); }
  }));

  tbody.querySelectorAll("[data-sh-del]").forEach(btn=>btn.addEventListener("click", async()=>{
    if(!confirm("حذف شود؟")) return;
    try{
      await apiFetch(`/api/shareholder-tx/${btn.dataset.shDel}`,{method:"DELETE"});
      await loadShareholderTx();
      showToast("حذف شد","success");
    }catch(e){ showToast(e.message,"error"); }
  }));
}

// ── Init ─────────────────────────────────────────────────────
function init(){
  setupPinPad("pin-pad","pin-display",password=>{
    const errEl=document.getElementById("login-error");
    errEl.classList.add("hidden");
    attemptLogin(password,msg=>{ errEl.textContent=msg; errEl.classList.remove("hidden"); shakeCard(".login-card"); });
  });

  document.getElementById("profile-btn").addEventListener("click",()=>{
    const p=document.getElementById("profile-panel");
    if(p.classList.contains("hidden")) openProfilePanel(); else closeProfilePanel();
  });
  document.getElementById("profile-overlay").addEventListener("click",closeProfilePanel);
  document.getElementById("logout-btn").addEventListener("click",logout);
  document.getElementById("change-pin-btn").addEventListener("click",openChangePinModal);
  document.getElementById("manage-charterers-btn").addEventListener("click",openCharterersModal);

  setupPinPad("new-pin-pad","new-pin-display",async p=>{
    if(newPinStep===0){
      firstPin=p; newPinStep=1;
      document.getElementById("new-pin-status").textContent="رمز جدید را دوباره وارد کنید";
    }else{
      if(p!==firstPin){
        document.getElementById("new-pin-status").textContent="❌ رمزها یکسان نبودند";
        newPinStep=0; firstPin=""; return;
      }
      try{
        await apiFetch("/api/change-pin",{method:"POST",body:JSON.stringify({new_pin:p})});
        state.token=p; localStorage.setItem("lc_token",p);
        closeChangePinModal(); playConfirm();
        showToast("رمز با موفقیت تغییر یافت","success");
      }catch(e){
        document.getElementById("new-pin-status").textContent="❌ "+e.message;
        newPinStep=0; firstPin="";
      }
    }
  });
  document.getElementById("modal-pin-cancel").addEventListener("click",closeChangePinModal);

  document.getElementById("modal-charterers-close").addEventListener("click",closeCharterersModal);
  document.getElementById("add-charterer-btn").addEventListener("click",async()=>{
    const inp=document.getElementById("charterer-name-input");
    const name=inp.value.trim(); if(!name){showToast("نام را وارد کنید","error");return;}
    try{
      await apiFetch("/api/charterers",{method:"POST",body:JSON.stringify({name})});
      inp.value=""; await loadCharterersList(); showToast("افزوده شد","success");
    }catch(e){ showToast(e.message,"error"); }
  });

  setupPullToRefresh();

  if(state.token&&state.name) showApp(); else showLogin();
}
init();
