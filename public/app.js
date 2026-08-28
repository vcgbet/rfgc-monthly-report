/* =============================================================================
 * ANLOGA DISTRICT RHEMA FULL GOSPEL CHURCHES — Monthly Report System (Frontend)
 * Roles: Secretary | Pastor | Admin  — real-time sync via Socket.IO
 * Developer: V. C. Gbetodeme | Contact: 0243302919
 * ============================================================================= */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));

const state = {
  token: localStorage.getItem('rfgc_token') || null,
  user: null, branches: [], reports: [], users: [], months: [], days: [], activities: [],
  role: 'secretary', page: 'entries', socket: null, live: false
};
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ------------------------------------------------------------------ helpers */
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function cap(s){ return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function toast(msg){ let t = $('#toast'); if(!t){ t = document.createElement('div'); t.id='toast'; document.body.appendChild(t);} t.textContent = msg; t.classList.add('show'); clearTimeout(t._to); t._to = setTimeout(() => t.classList.remove('show'), 2600); }

async function api(method, url, body){
  const r = await fetch(url, { method, headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

/* ------------------------------------------------------------------ login */
const roleMeta = {
  secretary: { hint: 'Branch Secretary — fill & submit monthly reports' },
  pastor:    { hint: 'Branch Pastor — review, endorse & export reports' },
  admin:     { hint: 'District Admin — full control of branches, staff & logins' }
};
function setRole(r){ state.role=r; $$('.role-tab').forEach(x=>x.classList.toggle('active', x.dataset.role===r)); $('#loginError').textContent=''; $('#loginHint').textContent=roleMeta[r].hint; }
$('#roleTabs').addEventListener('click', e => { const b = e.target.closest('.role-tab'); if (b) setRole(b.dataset.role); });

async function doLogin(){
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  $('#loginError').textContent = '';
  if (!username || !password){ $('#loginError').textContent = 'Please enter username and password.'; return; }
  const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res = await api('POST','/api/login', { username, password });
    state.token = res.token; localStorage.setItem('rfgc_token', state.token);
    await loadBootstrap(); enterApp();
  } catch (err){ $('#loginError').textContent = err.message; }
  btn.disabled = false; btn.textContent = 'Sign In';
}
$('#loginBtn').addEventListener('click', doLogin);
['#loginUsername','#loginPassword'].forEach(sel => $(sel).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
$('#logoutBtn').addEventListener('click', async () => { try { await api('POST','/api/logout'); } catch(e){} localStorage.removeItem('rfgc_token'); location.reload(); });

/* ------------------------------------------------------------ bootstrap -- */
async function loadBootstrap(){
  const data = await api('GET','/api/bootstrap');
  state.user = data.user; state.branches = data.branches; state.reports = data.reports;
  state.users = data.users || []; state.months = data.months; state.days = data.days; state.activities = data.activities;
}
function enterApp(){
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#userChip').textContent = state.user.name + ' (' + cap(state.user.role) + ')';
  connectSocket(); renderShell();
}

/* ----------------------------------------------------------- realtime -- */
function connectSocket(){
  if (state.socket) return;
  try {
    if (typeof io !== 'function') return;
    state.socket = io({ auth: { token: state.token } });
    state.socket.on('connect', () => state.socket.emit('register', state.token));
    const reload = () => { loadBootstrap().then(() => renderCurrentPage()).catch(()=>{}); };
    ['report:submitted','report:endorsed','report:updated','admin:branch','admin:users'].forEach(ev => state.socket.on(ev, reload));
  } catch(e) { /* realtime unavailable */ }
}

/* ------------------------------------------------------------- sidebar -- */
const NAV = {
  secretary: [ ['new','✍️ Create New Report'], ['entries','📥 Submitted Entries'] ],
  pastor:    [ ['review','🕵️ Review & Endorsement'], ['entries','📥 Submitted Entries'], ['analytics','📊 AI Analytics'], ['export','📄 PDF Export'] ],
  admin:     [ ['branches','🏛️ Branches'], ['credentials','🔑 Staff & Login Credentials'], ['entries','📥 Submitted Entries'], ['analytics','📊 AI Analytics'], ['export','📄 PDF Export'] ]
};
let activePage = 'entries';

function renderShell(){
  activePage = NAV[state.user.role][0][0];
  const sb = $('#sidebar');
  sb.innerHTML = NAV[state.user.role].map(n => `<button class="nav-item" data-page="${n[0]}">${n[1]}</button>`).join('');
  $$('#sidebar .nav-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.page)));
  renderCurrentPage();
}
function navigate(page){
  activePage = page;
  $$('#sidebar .nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  renderCurrentPage();
}
function renderCurrentPage(){
  const content = $('#content'); const p = activePage; const role = state.user.role;
  if (role === 'secretary'){ if (p === 'new') return renderSecretaryForm(content); return renderSecretaryEntries(content); }
  if (role === 'pastor'){
    if (p === 'review') return renderPastorReview(content);
    if (p === 'entries') return renderPastorEntries(content);
    if (p === 'analytics') return renderAnalytics(content);
    if (p === 'export') return renderExport(content);
  }
  if (role === 'admin'){
    if (p === 'branches') return renderAdminBranches(content);
    if (p === 'credentials') return renderAdminCredentials(content);
    if (p === 'entries') return renderAdminEntries(content);
    if (p === 'analytics') return renderAnalytics(content);
    if (p === 'export') return renderExport(content);
  }
}

/* ============================================================ SECRETARY === */
let freshForm = null;
function emptyDraft(){
  return { branchId:'', month:'', pastor:'', sunday:[{date:'',children:'',youth:'',women:'',men:''}],
    weekday:[{day:'',activity:'',others:'',children:'',youth:'',women:'',men:''}],
    finance:{tithes:'',sundayOfferings:'',weekdayOfferings:'',evangelismOffering:'',districtLevy:'',exchangeOfPulpit:''},
    secretary:{name: state.user ? state.user.name : '', date:'', signature:null, signatureType:null} };
}
function renderSecretaryForm(content){
  if (!freshForm) freshForm = emptyDraft();
  const d = freshForm; const me = state.user;
  const myBranch = state.branches.find(b => b.id === me.branchId);
  if (!d.branchId) d.branchId = myBranch ? myBranch.id : (state.branches[0] ? state.branches[0].id : '');
  if (!d.secretary.name) d.secretary.name = me.name;

  content.innerHTML = `
  <div class="section-head"><h2>Create New Monthly Report</h2>
    <div class="gap"><button class="btn btn-gold" id="btnNewForm">＋ New Report</button>
    <button class="btn btn-primary" id="btnSubmit">✅ Submit Report</button></div></div>

  <div class="card">
    <div class="form-row fr-2">
      <div class="form-group"><label>1. Name of Branch <span class="req">*</span></label>
        <select id="f_branch">${state.branches.map(b=>`<option value="${b.id}" ${b.id===d.branchId?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Month <span class="req">*</span></label>
        <select id="f_month"><option value="">— Select month —</option>${state.months.map(m=>`<option ${m===d.month?'selected':''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="form-row fr-2">
      <div class="form-group"><label>Branch Pastor <span class="req">*</span></label>
        <select id="f_pastor"><option value="">— Select pastor —</option></select></div>
    </div>
  </div>

  <div class="card">
    <div class="form-section-title">2. SUNDAY ATTENDANCE <span class="badge">auto total</span></div>
    <div class="muted" id="sunTotalLine">Total Sunday attendance: <strong>0</strong> persons</div>
    <table class="dyn-table"><thead><tr><th>Sunday Date</th><th>Children</th><th>Youth</th><th>Women</th><th>Men</th><th>Total</th><th></th></tr></thead>
      <tbody id="sunBody"></tbody></table>
    <button class="add-row-btn" id="sunAdd">＋ ADD SUNDAY</button>
  </div>

  <div class="card">
    <div class="form-section-title">3. WEEK DAY ATTENDANCE</div>
    <table class="dyn-table"><thead><tr><th>Day</th><th>Activity</th><th>Children</th><th>Youth</th><th>Women</th><th>Men</th><th></th></tr></thead>
      <tbody id="wdBody"></tbody></table>
    <button class="add-row-btn" id="wdAdd">＋ ADD DAY</button>
  </div>

  <div class="card">
    <div class="form-section-title">4. FINANCE</div>
    <div class="form-row fr-3">
      ${[['tithes','A. Tithes (GH¢)'],['sundayOfferings','B. Sunday Offerings (GH¢)'],['weekdayOfferings','C. Week Day Offerings (GH¢)'],['evangelismOffering','D. Evangelism Offering (GH¢)'],['districtLevy','E. District Levy (GH¢)'],['exchangeOfPulpit','F. Exchange of Pulpit (GH¢)']].map(f=>`<div class="form-group"><label>${f[1]}</label><input type="number" min="0" step="0.01" data-fin="${f[0]}" value="${esc(d.finance[f[0]])}"></div>`).join('')}
    </div>
  </div>

  <div class="card">
    <div class="form-section-title">5A. CHURCH SECRETARY ENDORSEMENT</div>
    <div class="form-row fr-3">
      <div class="form-group"><label>Name</label><input type="text" id="sec_name" value="${esc(d.secretary.name)}"></div>
      <div class="form-group"><label>Date</label><div class="date-wrap"><input type="text" id="sec_date" value="${esc(d.secretary.date)}" placeholder="dd/mm/yyyy"><button class="cal-btn" data-target="sec_date">📅</button></div></div>
      <div class="form-group"><label>Signature</label><div class="sign-box" id="sec_signbox">Click to add signature</div></div>
    </div>
  </div>

  <div class="right gap">
    <button class="btn btn-gold" id="btnNewFoot">＋ Create New Report</button>
    <button class="btn btn-primary" id="btnSubmitFoot">✅ Submit Report</button>
  </div>`;

  wireSunday(); wireWeekday(); wireFinance();
  renderPastorSelect();
  $('#f_branch').addEventListener('change', () => renderPastorSelect());

  const sb = $('#sec_signbox');
  if (d.secretary.signature) sb.innerHTML = `<img src="${d.secretary.signature}">`;
  sb.onclick = () => openSignature((data,type) => { d.secretary.signature = data; d.secretary.signatureType = type; sb.innerHTML = `<img src="${data}">`; });

  wireCalButtons(content);
  wireSubmitButtons();
}
function wireSubmitButtons(){
  $$('#btnSubmit,#btnSubmitFoot').forEach(b => b.addEventListener('click', handleSubmit));
  $$('#btnNewForm,#btnNewFoot').forEach(b => b.addEventListener('click', newReport));
}

function renderPastorSelect(){
  const sel = $('#f_pastor'); if (!sel) return;
  const all = state.branches.map(b => b.pastor).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
  sel.innerHTML = `<option value="">— Select pastor —</option>` + all.map(p=>`<option ${p===freshForm.pastor?'selected':''}>${esc(p)}</option>`).join('');
  const br = state.branches.find(b => b.id === $('#f_branch').value);
  if (br && br.pastor && !freshForm.pastor){ sel.value = br.pastor; freshForm.pastor = br.pastor; }
}

function wireSunday(){
  const body = $('#sunBody'); if (!body) return;
  const render = () => {
    body.innerHTML = freshForm.sunday.map((r,i)=>`<tr data-i="${i}">
      <td><div class="date-wrap"><input type="text" class="sun-date" value="${esc(r.date)}" placeholder="dd/mm/yyyy"><button class="cal-btn sun-cal" data-i="${i}">📅</button></div></td>
      <td><input type="number" min="0" class="sun-ch" value="${esc(r.children)}"></td>
      <td><input type="number" min="0" class="sun-yo" value="${esc(r.youth)}"></td>
      <td><input type="number" min="0" class="sun-wo" value="${esc(r.women)}"></td>
      <td><input type="number" min="0" class="sun-me" value="${esc(r.men)}"></td>
      <td class="dyn-total sun-tot">${num(r.children)+num(r.youth)+num(r.women)+num(r.men)}</td>
      <td><div class="row-actions"><button class="icon-btn del">🗑️</button></div></td></tr>`).join('');
    $$('#sunBody tr').forEach(tr => {
      const i = +tr.dataset.i; const r = freshForm.sunday[i];
      $$('input', tr).forEach(inp => inp.addEventListener('input', () => {
        if (inp.classList.contains('sun-date')) r.date = inp.value;
        else if (inp.classList.contains('sun-ch')) r.children = inp.value;
        else if (inp.classList.contains('sun-yo')) r.youth = inp.value;
        else if (inp.classList.contains('sun-wo')) r.women = inp.value;
        else if (inp.classList.contains('sun-me')) r.men = inp.value;
        $('.sun-tot', tr).textContent = num(r.children)+num(r.youth)+num(r.women)+num(r.men);
        updateSunTotal();
      }));
      $('.del', tr).addEventListener('click', () => { freshForm.sunday.splice(i,1); render(); updateSunTotal(); });
      $('.sun-cal', tr).addEventListener('click', e => { e.preventDefault(); const inp = tr.querySelector('.sun-date'); openCalendar(inp); });
    });
  };
  render(); updateSunTotal();
  $('#sunAdd').addEventListener('click', () => { freshForm.sunday.push({date:'',children:'',youth:'',women:'',men:''}); render(); });
}
function updateSunTotal(){
  const t = freshForm.sunday.reduce((a,r)=>a+num(r.children)+num(r.youth)+num(r.women)+num(r.men),0);
  const line = $('#sunTotalLine'); if (line) line.innerHTML = 'Total Sunday attendance: <strong>' + t + '</strong> persons';
}

function wireWeekday(){
  const body = $('#wdBody'); if (!body) return;
  const render = () => {
    body.innerHTML = freshForm.weekday.map((d,i)=>`<tr data-i="${i}">
      <td><select class="wd-day"><option value="">— Day —</option>${state.days.map(x=>`<option ${x===d.day?'selected':''}>${x}</option>`).join('')}</select></td>
      <td><select class="wd-activity"><option value="">— Activity —</option>${state.activities.map(x=>`<option ${x===d.activity?'selected':''}>${x}</option>`).join('')}</select>
          ${d.activity==='Others' ? `<input type="text" class="wd-others" value="${esc(d.others)}" placeholder="Type other activity here…">` : ''}</td>
      <td><input type="number" min="0" class="wd-ch" value="${esc(d.children)}"></td>
      <td><input type="number" min="0" class="wd-yo" value="${esc(d.youth)}"></td>
      <td><input type="number" min="0" class="wd-wo" value="${esc(d.women)}"></td>
      <td><input type="number" min="0" class="wd-me" value="${esc(d.men)}"></td>
      <td><div class="row-actions"><button class="icon-btn del">🗑️</button></div></td></tr>`).join('');
    $$('#wdBody tr').forEach(tr => {
      const i = +tr.dataset.i; const r = freshForm.weekday[i];
      const bindNum = (cls,key) => $(cls,tr).addEventListener('input', e => r[key]=e.target.value);
      bindNum('.wd-day','day'); bindNum('.wd-ch','children'); bindNum('.wd-yo','youth'); bindNum('.wd-wo','women'); bindNum('.wd-me','men');
      $('.wd-activity', tr).addEventListener('change', e => { r.activity = e.target.value; if (r.activity !== 'Others') r.others=''; render(); });
      $('.wd-ptr', tr).addEventListener('input', e => r.others = e.target.value);
      $('.del', tr).addEventListener('click', () => { freshForm.weekday.splice(i,1); render(); });
    });
  };
  render();
  $('#wdAdd').addEventListener('click', () => { freshForm.weekday.push({day:'',activity:'',others:'',children:'',youth:'',women:'',men:''}); render(); });
}

function wireFinance(){
  $$('#content [data-fin]').forEach(i => i.addEventListener('input', e => { freshForm.finance[e.target.dataset.fin] = e.target.value; }));
}

function handleSubmit(){
  const d = freshForm;
  d.branchId = $('#f_branch').value; d.month = $('#f_month').value; d.pastor = $('#f_pastor').value;
  d.secretary.name = $('#sec_name').value; d.secretary.date = $('#sec_date').value;
  if (!d.branchId) return toast('Please select a branch.');
  if (!d.month) return toast('Please select the month.');
  if (!d.sunday.length || !d.sunday.some(s => s.date)) return toast('Add at least one Sunday attendance row with a date.');
  api('POST','/api/reports', { branchId:d.branchId, month:d.month, sunday:d.sunday, weekday:d.weekday, finance:d.finance, secretary:d.secretary })
    .then(() => { toast('Report submitted to Pastor for review ✅'); freshForm = null; navigate('entries'); })
    .catch(err => toast(err.message));
}
function newReport(){ freshForm = null; navigate('new'); }
function dateButtons(){
  $$('#btnNewForm,#btnNewFoot').forEach(b => b.addEventListener('click', newReport));
  $$('#btnSubmit,#btnSubmitFoot').forEach(b => b.addEventListener('click', handleCal));
}

function renderSecretaryEntries(content){
  const list = state.reports.filter(r => r.status === 'submitted' || r.status === 'endorsed');
  content.innerHTML = `<div class="section-head"><h2>Submitted Entries</h2><button class="btn btn-gold" id="newEntryBtn">＋ Create New Report</button></div>` +
    (list.length === 0
      ? `<div class="card empty"><div class="big">📥</div><p>No submitted entries yet. Create and submit a new report.</p></div>`
      : `<table class="table"><thead><tr><th>Branch</th><th>Month</th><th>Submitted</th><th>Status</th><th>View</th></tr></thead><tbody>` +
        list.map(r=>`<tr><td>${esc(r.branchName)}</td><td>${esc(r.month||'—')}</td><td>${esc(new Date(r.submittedAt).toLocaleString())}</td><td><span class="pill ${r.status}">${r.status}</span></td><td><button class="btn btn-sm btn-ghost view-btn" data-id="${r.id}">👁️ View</button></td></tr>`).join('') + `</tbody></table>`);
  $('#newEntryBtn').addEventListener('click', newReport);
  $$('.view-btn', content).forEach(b => b.addEventListener('click', () => showReportModal(b.dataset.id)));
}

/* ============================================================== PASTOR ==== */
function renderPastorEntries(){
  const c = $('#content');
  const pending = state.reports.filter(r => r.status === 'submitted');
  const done = state.reports.filter(r => r.status === 'endorsed');
  c.innerHTML = `<div class="section-head"><h2>Submitted Entries</h2></div>
    <div class="form-section-title">Awaiting Endorsement</div>` +
    (pending.length===0 ? `<div class="card empty">No pending reports from your secretary.</div>`
      : `<table class="table"><thead><tr><th>Branch</th><th>Month</th><th>Submitted</th><th>Status</th><th>Review & Endorse</th></tr></thead><tbody>`+
        pending.map(r=>`<tr><td>${esc(r.branchName)}</td><td>${esc(r.month||'—')}</td><td>${esc(new Date(r.submittedAt).toLocaleString())}</td><td><span class="pill submitted">submitted</span></td><td><button class="btn btn-sm btn-green review-btn" data-id="${r.id}">🕵️ Review & Endorse</button></td></tr>`).join('')+`</tbody></table>`) +
    `<div class="form-section-title">Endorsed</div>` +
    (done.length===0 ? `<div class="card empty">Nothing endorsed yet.</div>`
      : `<table class="table"><thead><tr><th>Branch</th><th>Month</th><th>Endorsed</th><th>View</th></tr></thead><tbody>`+
        done.map(r=>`<tr><td>${esc(r.branchName)}</td><td>${esc(r.month||'—')}</td><td>${esc(new Date(r.endorsedAt).toLocaleString())}</td><td><button class="btn btn-sm btn-ghost view-btn" data-id="${r.id}">👁️</button></td></tr>`).join('')+`</tbody></table>`);
  $$('.review-btn', c).forEach(b => b.addEventListener('click', () => renderPastorReviewOf(b.dataset.id)));
  $$('.view-btn', c).forEach(b => b.addEventListener('click', () => showReportModal(b.dataset.id)));
}
function renderPastorReview(){
  const pending = state.reports.filter(r => r.status === 'submitted');
  if (pending.length === 0){ $('#content').innerHTML = `<div class="section-head"><h2>Review & Endorsement</h2></div><div class="card empty"><div class="big">✅</div>All clear! No reports awaiting your endorsement.</div>`; return; }
  renderPastorReviewOf(pending[0].id);
}
function renderPastorReviewOf(id){
  const c = $('#content');
  const r = state.reports.find(x => x.id === id);
  if (!r) return renderPastorEntries();
  const f = r.finance || {};
  c.innerHTML = `
  <div class="section-head"><h2>Review & Endorsement</h2><span class="pill submitted">submitted</span></div>
  <div class="card">
    <div class="form-row fr-2">
      <div class="form-group"><label>Branch</label><input type="text" value="${esc(r.branchName)}" disabled></div>
      <div class="form-group"><label>Month</label><select id="pe_month">${state.months.map(m=>`<option ${m===r.month?'selected':''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="form-section-title">2. SUNDAY ATTENDANCE</div>
    <table class="dyn-table"><thead><tr><th>Date</th><th>Children</th><th>Youth</th><th>Women</th><th>Men</th><th>Total</th></tr></thead><tbody id="pe_sun"></tbody></table>
    <div class="form-section-title mt">3. WEEK DAY ATTENDANCE</div>
    <table class="dyn-table"><thead><tr><th>Day</th><th>Activity</th><th>Children</th><th>Youth</th><th>Women</th><th>Men</th></tr></thead><tbody id="pe_wd"></tbody></table>
    <div class="form-section-title mt">4. FINANCE</div>
    <div class="form-row fr-3">
      ${[['tithes','Tithes'],['sundayOfferings','Sun Offerings'],['weekdayOfferings','Weekday Offerings'],['evangelismOffering','Evangelism'],['districtLevy','District Levy'],['exchangeOfPulpit','Exch. of Pulpit']].map(x=>`<div class="form-group"><label>${x[1]} (GH₵)</label><input type="number" data-fin="${x[0]}" value="${esc(f[x[0]])}"></div>`).join('')}
    </div>
  </div>
  <div class="card">
    <div class="form-section-title">5B. BRANCH PASTOR ENDORSEMENT</div>
    <div class="form-row fr-3">
      <div class="form-group"><label>Pastor Name</label><input type="text" id="pe_pastorName" value="${esc(r.pastor ? r.pastor.name : r.pastorName)}"></div>
      <div class="form-group"><label>Date</label><div class="date-wrap"><input type="text" id="pe_date" value="${esc(r.pastor ? r.pastor.date : '')}"><button class="cal-btn" data-target="pe_date">📅</button></div></div>
      <div class="form-group"><label>Signature</label><div class="sign-box" id="pe_sign">${r.pastor && r.pastor.signature ? `<img src="${r.pastor.signature}">` : 'Click to add signature'}</div></div>
    </div>
    <div class="right gap mt"><button class="btn btn-ghost" id="pe_save">💾 Save Edits</button><button class="btn btn-green" id="pe_endorse">✅ Endorse & Send to Admin</button></div>
  </div>`;
  renderPastSun(r); renderPastWd(r);
  $$('#content [data-fin]').forEach(i => i.addEventListener('input', e => { r.finance[e.target.dataset.fin] = e.target.value; }));
  const sigbox = $('#pe_sign');
  sigbox.onclick = () => openSignature((data,type) => { r.pastor = r.pastor || {name:'',date:'',signature:null,signatureType:null}; r.pastor.signature = data; r.pastor.signatureType = type; sigbox.innerHTML = `<img src="${data}">`; });
  wireCalButtons(c);
  const collect = () => {
    const m = $('#pe_month').value; if (m) r.month = m;
    r.sunday = $$('#pe_sun tr').map(tr => ({ date:$('.ps-date',tr).value, children:$('.ps-ch',tr).value, youth:$('.ps-yo',tr).value, women:$('.ps-wo',tr).value, men:$('.ps-me',tr).value }));
    r.weekday = $$('#pe_wd tr').map(tr => ({ day:$('.pw-day',tr).value, activity:$('.pw-act',tr).value, children:$('.pw-ch',tr).value, youth:$('.pw-yo',tr).value, women:$('.pw-wo',tr).value, men:$('.pw-me',tr).value }));
    $$('[data-fin]', c).forEach(i => { r.finance[i.dataset.fin] = i.value; });
  };
  $('#pe_save').addEventListener('click', async () => { collect(); await api('PUT','/api/reports/'+r.id, { sunday:r.sunday, weekday:r.weekday, finance:r.finance, pastor:r.pastor }); toast('Edits saved (still pending endorsement)'); });
  $('#pe_endorse').addEventListener('click', async () => {
    collect();
    r.pastor = r.pastor || {name:'',date:'',signature:null,signatureType:null};
    r.pastor.name = $('#pe_pastorName').value || r.pastorName || state.user.name;
    r.pastor.date = $('#pe_date').value;
    if (!r.pastor.signature) return toast('Please add the pastor’s signature before endorsing.');
    try { await api('POST','/api/reports/'+r.id+'/endorse',{ pastor:r.pastor }); toast('Report endorsed and sent to Admin ✅'); navigate('entries'); }
    catch(e){ toast(e.message); }
  });
}
function renderPastSun(r){
  const t = $('#pe_sun');
  t.innerHTML = (r.sunday||[]).map(s=>`<tr><td><input class="ps-date" value="${esc(s.date)}"></td><td><input class="ps-ch" type="number" value="${esc(s.children)}"></td><td><input class="ps-yo" type="number" value="${esc(s.youth)}"></td><td><input class="ps-wo" type="number" value="${esc(s.women)}"></td><td><input class="ps-me" type="number" value="${esc(s.men)}"></td><td class="dyn-total">${num(s.children)+num(s.youth)+num(s.women)+num(s.men)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No Sunday entries</td></tr>';
  $$('#pe_sun tr').forEach(tr => $$('input', tr).forEach(i => i.addEventListener('input', () => tr.querySelector('.dyn-total').textContent = num(tr.querySelector('.ps-ch').value)+num(tr.querySelector('.ps-yo').value)+num(tr.querySelector('.ps-wo').value)+num(tr.querySelector('.ps-me').value))));
}
function renderPastWd(r){
  const t = $('#pe_wd');
  t.innerHTML = (r.weekday||[]).map(w=>`<tr><td><select class="pw-day">${state.days.map(x=>`<option ${x===w.day?'selected':''}>${x}</option>`).join('')}</select></td><td><input class="pw-act" value="${esc(w.activity||'')}${w.others?' — '+esc(w.others):''}"></td><td><input class="pw-ch" type="number" value="${esc(w.children)}"></td><td><input class="pw-yo" type="number" value="${esc(w.youth)}"></td><td><input class="pw-wo" type="number" value="${esc(w.women)}"></td><td><input class="pw-me" type="number" value="${esc(w.men)}"></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No weekday entries</td></tr>';
}

/* ============================================================== ANALYTICS */
async function renderAnalytics(){
  const c = $('#content');
  c.innerHTML = `<div class="section-head"><h2>📊 AI Analytics</h2></div><div class="card"><div class="empty">Loading analytics…</div></div>`;
  try {
    const a = await api('GET','/api/analytics');
    const maxB = Math.max(1, ...a.byBranch.map(b=>b.total));
    const streams = [['Tithes',a.finance.tithes],['Sun Offerings',a.finance.sundayOfferings],['Weekday Offerings',a.finance.weekdayOfferings],['Evangelism',a.finance.evangelismOffering],['District Levy',a.finance.districtLevy],['Exchange of Pulpit',a.finance.exchangeOfPulpit]];
    const maxF = Math.max(1, ...streams.map(s=>s[1]));
    const llmcfg = state.user.role==='admin' ? await api('GET','/api/admin/llm').catch(()=>({baseUrl:'',model:''})) : {baseUrl:'',model:''};
    const aiBadge = a.aiSource==='llm' ? '<span class="pill green" style="margin-left:8px">✨ Live AI</span>' : '<span class="pill draft" style="margin-left:8px">Built-in engine</span>';
    const aiSettingsHtml = state.user.role==='admin' ? `
    <div class="card">
      <div class="form-section-title">🤖 AI Settings <span class="badge">Admin</span></div>
      <div class="muted">Paste a <b>free</b> OpenAI-compatible API key to enable live generative insights. Free options (no credit card): <b>Groq</b> (console.groq.com), <b>Google Gemini</b> (aistudio.google.com), or <b>OpenRouter</b>. ${a.llmConfigured ? 'A key is currently set — insights are live ✨.' : 'No key set yet — the built-in engine is being used.'}</div>
      <div class="form-row fr-3 mt">
        <div class="form-group"><label>API Key</label><input type="password" id="llm_key" placeholder="your free key"></div>
        <div class="form-group"><label>Base URL (optional)</label><input type="text" id="llm_base" placeholder="https://api.openai.com/v1"></div>
        <div class="form-group"><label>Model (optional)</label><input type="text" id="llm_model" placeholder="gpt-4o-mini"></div>
      </div>
      <div class="right gap mt"><button class="btn btn-ghost btn-sm" id="llm_clear">Remove key</button><button class="btn btn-primary" id="llm_save">Save &amp; Apply</button></div>
    </div>` : '';
    c.innerHTML = `
    <div class="section-head"><h2>📊 AI Analytics</h2></div>
    <div class="grid grid-3">
      <div class="stat-card"><div class="lbl">Total Attendance</div><div class="num">${a.totals.total.toLocaleString()}</div></div>
      <div class="stat-card"><div class="lbl">Total Revenue (GH₵)</div><div class="num">${num(a.finance.total).toLocaleString()}</div></div>
      <div class="stat-card"><div class="lbl">Reports Analysed</div><div class="num">${a.totalReports}</div></div>
    </div>
    <div class="card"><div class="form-section-title">🧠 AI-Generated Insights ${aiBadge}</div>
      ${a.insights.map(i=>`<div class="insight">${esc(i)}</div>`).join('') || '<div class="empty">No data yet.</div>'}
      ${a.aiNote ? `<div class="muted mt">${esc(a.aiNote)}</div>` : ''}</div>
    ${aiSettingsHtml}
    <div class="grid grid-2">
      <div class="card"><div class="form-section-title">Attendance by Branch</div>
        ${a.byBranch.length===0?'<div class="empty">No data yet</div>':a.byBranch.map(b=>`<div class="bar-row"><div class="bar-label">${esc(b.branch)}</div><div class="bar-track"><div class="bar-fill" style="width:${(b.total/maxB*100).toFixed(0)}%">${b.total}</div></div></div>`).join('')}
      </div>
      <div class="card"><div class="form-section-title">Attendance by Demography</div>
        ${[['Children',a.totals.children,'#e63946'],['Youth',a.totals.youth,'#2a9d8f'],['Women',a.totals.women,'#e9c46a'],['Men',a.totals.men,'#457b9d']].map(d=>`<div class="bar-row"><div class="bar-label">${d[0]}</div><div class="bar-track"><div class="bar-fill" style="width:${(d[1]/Math.max(1,a.totals.total)*100).toFixed(0)}%;background:${d[2]}">${d[1]}</div></div></div>`).join('')}
      </div>
    </div>
    <div class="card"><div class="form-section-title">Revenue Streams</div>
      ${streams.map(s=>`<div class="bar-row"><div class="bar-label">${s[0]}</div><div class="bar-track"><div class="bar-fill" style="width:${(s[1]/maxF*100).toFixed(0)}%;background:#1e56a0">GH₵ ${num(s[1]).toLocaleString()}</div></div></div>`).join('')}
    </div>`;
    if (state.user.role==='admin'){
      const key = $('#llm_key'), base = $('#llm_base'), model = $('#llm_model');
      if (base && llmcfg.baseUrl) base.value = llmcfg.baseUrl;
      if (model && llmcfg.model) model.value = llmcfg.model;
      const save = $('#llm_save');
      if (save) save.addEventListener('click', async () => {
        await api('PUT','/api/admin/llm',{ apiKey:(key?key.value:'').trim(), baseUrl:(base?base.value:'').trim(), model:(model?model.value:'').trim() });
        toast('AI settings saved — insights will now use live AI'); renderAnalytics();
      });
      const clr = $('#llm_clear');
      if (clr) clr.addEventListener('click', async () => {
        await api('PUT','/api/admin/llm',{ apiKey:'', baseUrl:'', model:'' });
        toast('AI key removed'); renderAnalytics();
      });
    }
  } catch(e){ c.innerHTML = `<div class="section-head"><h2>📊 AI Analytics</h2></div><div class="card"><div class="empty">Could not load analytics.</div></div>`; }
}

/* ============================================================ EXPORT ==== */
function renderExport(){
  const c = $('#content');
  const list = state.reports.slice().sort((a,b)=>b.submittedAt-a.submittedAt);
  c.innerHTML = `<div class="section-head"><h2>📄 PDF Export</h2></div>
  <div class="card"><div class="muted">Generate a print-ready PDF of any report. Open the report, then choose <b>“Save as PDF”</b> as the destination in the print dialog.</div></div>
  ${list.length===0 ? `<div class="card empty">No reports to export.</div>`
    : `<table class="table"><thead><tr><th>Branch</th><th>Month</th><th>Status</th><th>Export PDF</th></tr></thead><tbody>`+
      list.map(r=>`<tr><td>${esc(r.branchName)}</td><td>${esc(r.month||'—')}</td><td><span class="pill ${r.status}">${r.status}</span></td><td><button class="btn btn-sm btn-gold pdf-btn" data-id="${r.id}">⬇️ PDF</button></td></tr>`).join('')+`</tbody></table>`}`;
  $$('.pdf-btn', c).forEach(b => b.addEventListener('click', () => printReport(state.reports.find(x=>x.id===b.dataset.id))));
}
function sigImg(r){ return r && r.signature ? `<img class="sig" src="${r.signature}">` : '<span class="nosig">No signature</span>'; }
function printReport(r){
  if (!r) return;
  const f = r.finance || {};
  const sunRows = (r.sunday||[]).map(s=>`<tr><td>${esc(s.date||'')}</td><td>${num(s.children)}</td><td>${num(s.youth)}</td><td>${num(s.women)}</td><td>${num(s.men)}</td><td><b>${num(s.children)+num(s.youth)+num(s.women)+num(s.men)}</b></td></tr>`).join('');
  const wdRows = (r.weekday||[]).map(w=>`<tr><td>${esc(w.day||'')}</td><td>${esc(w.activity||'')}${w.others?' — '+esc(w.others):''}</td><td>${num(w.children)}</td><td>${num(w.youth)}</td><td>${num(w.women)}</td><td>${num(w.men)}</td></tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(r.branchName)} - ${esc(r.month)} Report</title><style>
    body{font-family:Georgia,serif;color:#111;padding:30px;max-width:780px;margin:auto}
    .head{text-align:center;border-bottom:3px solid #123a6b;padding-bottom:12px}
    .head h1{margin:0;font-size:20px;color:#123a6b}.head h2{margin:4px 0;font-size:15px;letter-spacing:2px;color:#b8860b}
    .sub{text-align:center;margin:8px 0 16px;font-size:13px;color:#555}
    h3{color:#123a6b;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:22px}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
    th,td{border:1px solid #999;padding:6px 8px;text-align:left}
    th{background:#eef2f7}
    .endorse{margin-top:28px}
    .sig{max-height:70px;margin-top:4px}
    .nosig{color:#999;font-style:italic;font-size:12px}
    .foot{text-align:center;margin-top:30px;font-size:11px;color:#777;border-top:1px solid #ccc;padding-top:8px}
    @media print{@page{margin:16mm}}
  </style></head><body>
    <div class="head"><h1>ANLOGA DISTRICT RHEMA FULL GOSPEL CHURCHES</h1><h2>MONTHLY REPORT</h2></div>
    <div class="sub"><b>Branch:</b> ${esc(r.branchName)} &nbsp;|&nbsp; <b>Month:</b> ${esc(r.month||'—')} &nbsp;|&nbsp; <b>Pastor:</b> ${esc(r.pastorName||'—')}</div>
    <h3>2. SUNDAY ATTENDANCE</h3>
    <table><thead><tr><th>Date</th><th>Children</th><th>Youth</th><th>Women</th><th>Men</th><th>Total</th></tr></thead><tbody>${sunRows||'<tr><td colspan="6">—</td></tr>'}</tbody></table>
    <h3>3. WEEK DAY ATTENDANCE</h3>
    <table><thead><tr><th>Day</th><th>Activity</th><th>Children</th><th>Youth</th><th>Women</th><th>Men</th></tr></thead><tbody>${wdRows||'<tr><td colspan="6">—</td></tr>'}</tbody></table>
    <h3>4. FINANCE</h3>
    <table><tbody>
      <tr><td>A. Tithes</td><td><b>GH₵ ${num(f.tithes).toFixed(2)}</b></td><td>D. Evangelism Offering</td><td><b>GH₵ ${num(f.evangelismOffering).toFixed(2)}</b></td></tr>
      <tr><td>B. Sunday Offerings</td><td><b>GH₵ ${num(f.sundayOfferings).toFixed(2)}</b></td><td>E. District Levy</td><td><b>GH₵ ${num(f.districtLevy).toFixed(2)}</b></td></tr>
      <tr><td>C. Week Day Offerings</td><td><b>GH₵ ${num(f.weekdayOfferings).toFixed(2)}</b></td><td>F. Exchange of Pulpit</td><td><b>GH₵ ${num(f.exchangeOfPulpit).toFixed(2)}</b></td></tr>
    </tbody></table>
    <div class="endorse"><h3>5. ENDORSEMENT</h3>
      <div><b>A. Church Secretary:</b> ${esc(r.secretary&&r.secretary.name||'')} &nbsp; Date: ${esc(r.secretary&&r.secretary.date||'')}<br>${sigImg(r.secretary)}</div>
      <div style="margin-top:18px"><b>B. Branch Pastor:</b> ${esc(r.pastor&&r.pastor.name||'')} &nbsp; Date: ${esc(r.pastor&&r.pastor.date||'')}<br>${sigImg(r.pastor)}</div>
    </div>
    <div class="foot">ANLOGA DISTRICT RHEMA FULL GOSPEL CHURCHES — Monthly Report<br>Developed by V. C. Gbetodeme | Contact: 0243302919</div>
    <script>window.onload=function(){window.print();};<\/script>
  </body></html>`);
  w.document.close();
}

/* ============================================================== ADMIN ==== */
function branchName(id){ const b = state.branches.find(x=>x.id===id); return b ? b.name : '—'; }
function renderAdminBranches(){
  const c = $('#content');
  c.innerHTML = `<div class="section-head"><h2>🏛️ Branches</h2><button class="btn btn-gold" id="addBranchBtn">＋ Add Branch</button></div>
  <div class="card" id="branchFormCard" style="display:none">
    <div class="form-row fr-2">
      <div class="form-group"><label>Branch Name</label><input type="text" id="br_name"></div>
      <div class="form-group"><label>Branch Pastor</label><input type="text" id="br_pastor"></div>
    </div>
    <div class="right gap"><button class="btn btn-ghost" id="br_cancel">Cancel</button><button class="btn btn-primary" id="br_save">Save Branch</button></div>
  </div>
  <table class="table"><thead><tr><th>Branch</th><th>Pastor</th><th>Actions</th></tr></thead><tbody>
  ${state.branches.map(b=>`<tr data-id="${b.id}"><td>${esc(b.name)}</td><td>${esc(b.pastor)}</td><td><div class="gap"><button class="btn btn-sm btn-ghost ed-br">✏️ Edit</button><button class="btn btn-sm btn-red del-br">🗑️ Delete</button></div></td></tr>`).join('')}
  </tbody></table>`;
  let editId = null; const form = $('#branchFormCard');
  $('#addBranchBtn').addEventListener('click', ()=>{ editId=null; $('#br_name').value=''; $('#br_pastor').value=''; form.style.display='block'; });
  $('#br_cancel').addEventListener('click', ()=>form.style.display='none');
  $('#br_save').addEventListener('click', async ()=>{
    const name = $('#br_name').value.trim(), pastor = $('#br_pastor').value.trim();
    if (!name) return toast('Branch name required');
    try { if (editId) await api('PUT','/api/admin/branches/'+editId,{name,pastor}); else await api('POST','/api/admin/branches',{name,pastor}); form.style.display='none'; toast('Branch saved'); await loadBootstrap(); renderCurrentPage(); }
    catch(e){ toast(e.message); }
  });
  $$('.ed-br', c).forEach(b=>b.addEventListener('click', ()=>{ const id=b.closest('tr').dataset.id; const br=state.branches.find(x=>x.id===id); editId=id; $('#br_name').value=br.name; $('#br_pastor').value=br.pastor; form.style.display='block'; }));
  $$('.del-br', c).forEach(b=>b.addEventListener('click', async ()=>{ const id=b.closest('tr').dataset.id; if(!confirm('Delete this branch?'))return; await api('DELETE','/api/admin/branches/'+id); await loadBootstrap(); renderCurrentPage(); toast('Branch deleted'); }));
}
function renderAdminCredentials(){
  const c = $('#content');
  const users = state.users; const pastors = users.filter(u=>u.role==='pastor'); const secs = users.filter(u=>u.role==='secretary');
  c.innerHTML = `<div class="section-head"><h2>🔑 Staff & Login Credentials</h2><div class="gap"><button class="btn btn-gold" id="addUserBtn">＋ Add Staff Login</button><button class="btn btn-ghost" id="genBtn">⚙️ Auto-generate Pastor Logins</button></div></div>
  <div class="card"><div class="form-section-title">PASTORS — Login Credentials</div>
    ${pastors.map(u=>`<div class="cred-row" data-id="${u.id}">
      <div><b>${esc(u.name)}</b> <span class="muted">(${esc(branchName(u.branchId))})</span><br>
        <span class="muted">Username:</span> <code>${esc(u.username)}</code> &nbsp;
        <span class="muted">Password:</span> <code>${esc(u.generatedPassword||'••••••')}</code></div>
      <div class="gap"><button class="btn btn-sm btn-ghost res-p">Reset</button></div></div>`).join('') || '<div class="empty">No pastors</div>'}
  </div>
  <div class="card"><div class="form-section-title">SECRETARIES</div>
    ${secs.map(u=>`<div class="cred-row" data-id="${u.id}">
      <div><b>${esc(u.name)}</b> <span class="muted">(${esc(branchName(u.branchId))})</span><br>
        <span class="muted">Username:</span> <code>${esc(u.username)}</code> &nbsp;
        <span class="muted">Password:</span> <code>${esc(u.generatedPassword||'••••••')}</code></div>
      <div class="gap"><button class="btn btn-sm btn-ghost res-user">Reset</button><button class="btn btn-sm btn-red del-user">Delete</button></div></div>`).join('') || '<div class="empty">No secretaries yet</div>'}
  </div>
  <div class="card" id="userFormCard" style="display:none">
    <div class="form-row fr-2">
      <div class="form-group"><label>Role</label><select id="u_role"><option value="secretary">Secretary</option><option value="pastor">Pastor</option></select></div>
      <div class="form-group"><label>Full Name</label><input type="text" id="u_name"></div>
      <div class="form-group"><label>Username</label><input type="text" id="u_username"></div>
      <div class="form-group"><label>Password</label><input type="text" id="u_password"></div>
      <div class="form-group"><label>Assigned Branch</label><select id="u_branch"><option value="">—</option>${state.branches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="right gap"><button class="btn btn-ghost" id="u_cancel">Cancel</button><button class="btn btn-primary" id="u_save">Save Staff</button></div>
  </div>`;
  const form = $('#userFormCard');
  $('#addUserBtn').addEventListener('click', ()=>{ form.style.display='block'; ['u_name','u_username','u_password'].forEach(i=>$('#'+i).value=''); $('#u_role').value='secretary'; });
  $('#u_cancel').addEventListener('click', ()=>form.style.display='none');
  $('#u_save').addEventListener('click', async ()=>{
    const p = { role:$('#u_role').value, name:$('#u_name').value.trim(), username:$('#u_username').value.trim(), password:$('#u_password').value, branchId:$('#u_branch').value };
    if(!p.username || !p.password){ toast('Username and password required'); return; }
    try { await api('POST','/api/admin/users', p); form.style.display='none'; toast('Staff added'); await loadBootstrap(); renderCurrentPage(); } catch(e){ toast(e.message); }
  });
  const res = async (b,label)=>{ const id=b.closest('.cred-row').dataset.id; const r=await api('POST','/api/admin/users/'+id+'/reset'); toast(label+' new password: '+r.generatedPassword); await loadBootstrap(); renderCurrentPage(); };
  $$('.res-p', c).forEach(b=>b.addEventListener('click', ()=>res(b,'Pastor ')));
  $$('.res-user', c).forEach(b=>b.addEventListener('click', ()=>res(b,'Staff ')));
  $$('.del-user', c).forEach(b=>b.addEventListener('click', async ()=>{ const id=b.closest('.cred-row').dataset.id; if(!confirm('Delete this staff login?'))return; await api('DELETE','/api/admin/users/'+id); toast('Staff deleted'); await loadBootstrap(); renderCurrentPage(); }));
  $('#genBtn').addEventListener('click', () => toast('Auto-generating unique logins for all pastors…'));
}
function renderAdminEntries(){
  const c = $('#content');
  const list = state.reports.slice().sort((a,b)=>b.submittedAt-a.submittedAt);
  c.innerHTML = `<div class="section-head"><h2>📥 Submitted Entries (All Branches)</h2></div>
  ${list.length===0 ? `<div class="card empty"><div class="big">📭</div>No reports submitted yet.</div>`
    : `<table class="table"><thead><tr><th>Branch</th><th>Month</th><th>Pastor</th><th>Submitted</th><th>Status</th><th>View</th></tr></thead><tbody>`+
      list.map(r=>`<tr><td>${esc(r.branchName)}</td><td>${esc(r.month||'—')}</td><td>${esc(r.pastorName||'')}</td><td>${esc(new Date(r.submittedAt).toLocaleDateString())}</td><td><span class="pill ${r.status}">${r.status}</span></td><td><div class="gap"><button class="btn btn-sm btn-ghost view-btn" data-id="${r.id}">👁️</button><button class="btn btn-sm btn-gold pdf-btn" data-id="${r.id}">PDF</button></div></td></tr>`).join('')+`</tbody></table>`}`;
  $$('.view-btn', c).forEach(b=>b.addEventListener('click', ()=>showReportModal(b.dataset.id)));
  $$('.pdf-btn', c).forEach(b=>b.addEventListener('click', ()=>printReport(state.reports.find(x=>x.id===b.dataset.id))));
}

/* ================================================== report view modal ==== */
function showReportModal(id){
  const r = state.reports.find(x=>x.id===id); if(!r) return;
  const f = r.finance||{};
  const sunRows = (r.sunday||[]).map(s=>`<tr><td>${esc(s.date||'')}</td><td>${num(s.children)}</td><td>${num(s.youth)}</td><td>${num(s.women)}</td><td>${num(s.men)}</td><td><b>${num(s.children)+num(s.youth)+num(s.women)+num(s.men)}</b></td></tr>`).join('');
  const wdRows = (r.weekday||[]).map(w=>`<tr><td>${esc(w.day||'')}</td><td>${esc(w.activity||'')}${w.others?' — '+esc(w.others):''}</td><td>${num(w.children)}</td><td>${num(w.youth)}</td><td>${num(w.women)}</td><td>${num(w.men)}</td></tr>`).join('');
  const m = document.createElement('div'); m.className='modal'; m.innerHTML = `<div class="modal-box" style="max-width:880px">
    <div class="modal-head"><h3>Monthly Report — ${esc(r.branchName)} (${esc(r.month||'—')})</h3><button class="modal-x" data-close>×</button></div>
    <div style="max-height:68vh;overflow:auto">
      <h4>SUNDAY ATTENDANCE</h4><table class="table"><thead><tr><th>Date</th><th>C</th><th>Y</th><th>W</th><th>M</th><th>Total</th></tr></thead><tbody>${sunRows||'<tr><td colspan="6">—</td></tr>'}</tbody></table>
      <h4>WEEK DAY ATTENDANCE</h4><table class="table"><thead><tr><th>Day</th><th>Activity</th><th>C</th><th>Y</th><th>W</th><th>M</th></tr></thead><tbody>${wdRows||'<tr><td colspan="6">—</td></tr>'}</tbody></table>
      <h4>FINANCE</h4><table class="table"><tbody>
        <tr><td>A. Tithes</td><td>GH₵ ${num(f.tithes)}</td><td>D. Evangelism</td><td>GH₵ ${num(f.evangelismOffering)}</td></tr>
        <tr><td>B. Sun Offerings</td><td>GH₵ ${num(f.sundayOfferings)}</td><td>E. District Levy</td><td>GH₵ ${num(f.districtLevy)}</td></tr>
        <tr><td>C. Weekday Offerings</td><td>GH₵ ${num(f.weekdayOfferings)}</td><td>F. Exchange of Pulpit</td><td>GH₵ ${num(f.exchangeOfPulpit)}</td></tr>
      </tbody></table>
      <h4>ENDORSEMENT</h4>
      <p><b>A. Secretary:</b> ${esc(r.secretary&&r.secretary.name||'')} — ${esc(r.secretary&&r.secretary.date||'')}${r.secretary&&r.secretary.signature?' ✅ Signed':''}</p>
      <p><b>B. Pastor:</b> ${esc(r.pastor&&r.pastor.name||'')} — ${esc(r.pastor&&r.pastor.date||'')}${r.pastor&&r.pastor.signature?' ✅ Signed':''}</p>
    </div>
    <div class="right gap mt"><button class="btn btn-gold" data-pdf>Export PDF</button><button class="btn btn-ghost" data-close>Close</button></div></div>`;
  document.body.appendChild(m);
  const close = ()=>{ m.remove(); document.removeEventListener('keydown', kd); };
  const kd = e=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown', kd);
  m.addEventListener('click', e=>{ if(e.target===m || e.target.closest('[data-close]')) close(); });
  const pdf = m.querySelector('[data-pdf]'); if(pdf) pdf.addEventListener('click', ()=>{ printReport(r); });
}

/* ============================================================ signature == */
let signCallback = null, signMode = 'draw', signPoints = [], signActive = false, signLast = null;
function openSignature(cb){ signCallback = cb; signMode='draw'; $('#signModal').classList.remove('hidden'); setupSignTabs(); setupCanvas(); }
function setupSignTabs(){
  $$('.sign-tab').forEach(t=>{ t.classList.toggle('active', t.dataset.mode===signMode); t.onclick=()=>{ signMode=t.dataset.mode; setupSignTabs(); setupCanvas(); }; });
  $('#signUploadArea').classList.toggle('hidden', signMode!=='upload');
  $('#signCanvas').classList.toggle('hidden', signMode==='upload');
}
function setupCanvas(){
  const c = $('#signCanvas'); if(!c) return;
  c.width = c.offsetWidth || 560; c.height = 200;
  const ctx = c.getContext('2d');
  if (!ctx) { return; }
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle='#123a6b'; ctx.lineWidth=2.5; ctx.lineCap='round';
  signPoints = [];
  const pos = e => { const r=c.getBoundingClientRect(); return {x:(e.clientX-r.left)*(c.width/r.width), y:(e.clientY-r.top)*(c.height/r.height)}; };
  c.onpointerdown = e => { signActive=true; signLast=pos(e); c.setPointerCapture(e.pointerId); };
  c.onpointermove = e => { if(!signActive)return; const p=pos(e); ctx.beginPath(); ctx.moveTo(signLast.x,signLast.y); ctx.lineTo(p.x,p.y); ctx.stroke(); signPoints.push(p); signLast=p; };
  c.onpointerup = c.onpointerleave = ()=>{ signActive=false; };
}
$('#signClear').addEventListener('click', ()=>{ if(signMode==='draw') setupCanvas(); else { $('#signPreview').src=''; $('#signFile').value=''; } });
$('#signSave').addEventListener('click', ()=>{
  let data=null, type=null;
  if(signMode==='draw'){ if(signPoints.length===0){ toast('Please draw a signature'); return; } data=$('#signCanvas').toDataURL('image/png'); type='draw'; }
  else { const img=$('#signPreview'); if(!img.src){ toast('Please upload an image'); return; } data=img.src; type='upload'; }
  if(signCallback){ signCallback(data,type); signCallback=null; }
  $('#signModal').classList.add('hidden');
});
$('#signModalClose').addEventListener('click', ()=>{ $('#signModal').classList.add('hidden'); signCallback=null; });
$('#signFile').addEventListener('change', e=>{ const f=e.target.files[0]; if(!f)return; const rd=new FileReader(); rd.onload=()=>{ $('#signPreview').src=rd.result; }; rd.readAsDataURL(f); });

/* ============================================================ calendar ==== */
function wireCalButtons(root){
  $$('.cal-btn[data-target]', root).forEach(b => b.addEventListener('click', e => { e.preventDefault(); const inp = document.getElementById(b.dataset.target); if (inp) openCalendar(inp); }));
}
function openCalendar(input){
  if (!input) return;
  $$('.cal-pop').forEach(p=>p.remove());
  let dt = parse(input.value);
  let vy = dt.getFullYear(), vm = dt.getMonth();
  function parse(s){ const p=String(s).split(/[/-]/); if(p.length>=3){ const d=+p[0],m=+p[1]-1,y=+p[2]; if(!isNaN(d)&&!isNaN(m)&&!isNaN(y)) return new Date(y,m,d); } return new Date(); }
  const pop = document.createElement('div'); pop.className='cal-pop';
  function draw(){
    pop.innerHTML='';
    const head=document.createElement('div'); head.className='cal-head';
    const prev=document.createElement('button'); prev.textContent='◀';
    const title=document.createElement('span'); title.textContent=MONTHS[vm]+' '+vy;
    const next=document.createElement('button'); next.textContent='▶';
    prev.onclick=()=>{ vm--; if(vm<0){vm=11;vy--;} draw(); };
    next.onclick=()=>{ vm++; if(vm>11){vm=0;vy++;} draw(); };
    head.append(prev,title,next); pop.appendChild(head);
    const grid=document.createElement('div'); grid.className='cal-grid';
    ['S','M','T','W','T','F','S'].forEach(d=>{ const s=document.createElement('span'); s.textContent=d; grid.appendChild(s); });
    const first=new Date(vy,vm,1).getDay(), days=new Date(vy,vm+1,0).getDate();
    for(let i=0;i<first;i++) grid.appendChild(document.createElement('span'));
    for(let d=1;d<=days;d++){ const b=document.createElement('button'); b.textContent=d; b.onclick=()=>{ input.value=String(d).padStart(2,'0')+'/'+String(vm+1).padStart(2,'0')+'/'+vy; pop.remove(); input.dispatchEvent(new Event('input',{bubbles:true})); }; grid.appendChild(b); }
    pop.appendChild(grid);
  }
  draw();
  (input.closest('.date-wrap') || input.parentElement).appendChild(pop);
}

/* ================================================================ boot ==== */
window.addEventListener('DOMContentLoaded', async () => {
  if (state.token){
    try { await loadBootstrap(); enterApp(); return; }
    catch(e){ localStorage.removeItem('rfgc_token'); state.token=null; }
  }
  setRole('secretary');
});