'use strict';
/* =============================================================================
 * ANLOGA DISTRICT RHEMA FULL GOSPEL CHURCHES - MONTHLY REPORT SYSTEM
 * Backend: Express + Socket.IO (real-time cross-device sync) + JSON file store
 * Developer: V. C. Gbetodeme | Contact: 0243302919
 * ============================================================================= */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
// Force IPv4 lookups — Render can't reach Supabase over IPv6 (ENETUNREACH)
dns.setDefaultResultOrder('ipv4first');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ helpers */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const randPass = () => 'Rf@' + crypto.randomBytes(3).toString('hex').toUpperCase() + Math.random().toString().slice(2, 4);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const ACTIVITIES = ['Bible Studies','Crusade','Fasting & Prayers','Prayer Service','Revival Service','Others'];

/* ---------------------------------------------------------------- seed data -- */
const SEED_BRANCHES = [
  { name: 'Agbledomi', pastor: 'Rev. Reuben Afadzinu' },
  { name: 'Agorve', pastor: 'Pastor Wisdom Amudzi' },
  { name: 'Biwater – Dominion Center', pastor: 'Rev. Dr. John Kugbadzor' },
  { name: 'Genui – Love Chapel', pastor: 'Pastor Victor C. Gbetodeme' },
  { name: 'KportorGbe', pastor: 'Rev. Wisdom Fiador' },
  { name: 'Whuti – Salvation Centre', pastor: 'Rev. Godwin AyeKple' },
];

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 18);
}

function seedDB() {
  const branches = SEED_BRANCHES.map((b, i) => ({ id: 'br_' + (i + 1), name: b.name, pastor: b.pastor }));
  const users = [
    { id: 'u_admin', role: 'admin', username: 'admin', passwordHash: sha('password123'), name: 'System Administrator', branchId: null, phone: '' },
  ];
  // auto-generate unique login details for every pastor (one account per branch)
  branches.forEach((b, i) => {
    const uname = 'pastor.' + (slug(b.name).split('.').pop() || 'branch') + '.' + (i + 1);
    const pass = randPass();
    users.push({ id: 'u_' + uid(), role: 'pastor', username: uname, passwordHash: sha(pass), generatedPassword: pass, name: b.pastor, branchId: b.id, phone: '', _auto: true });
  });
  // a convenience demo secretary for the first branch
  const demoSec = { id: 'u_' + uid(), role: 'secretary', username: 'secretary.agbledomi', passwordHash: sha('secret123'), generatedPassword: 'secret123', name: 'Agbledomi Secretary', branchId: 'br_1', phone: '' };
  users.push(demoSec);
  return { branches, users, reports: [] };
}
/* ------------------------------------------------------------------ store ---- */
let db = { branches: [], users: [], reports: [] };
/* Persistence: if DATABASE_URL (Postgres) is set, the whole app state is stored as one
   JSON blob in Postgres so it survives every Render restart/redeploy. Otherwise it uses
   the local file (data/db.json). Any Postgres failure falls back to the file so the app
   always works. */
const USES_PG = !!process.env.DATABASE_URL;
let pgPool = null;
async function connectPg() {
  if (pgPool) return pgPool;
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, query_timeout: 8000, statement_timeout: 8000 });
    await pgPool.query('CREATE TABLE IF NOT EXISTS app_state (id text primary key, data jsonb, updated_at timestamptz default now())');
    return pgPool;
  } catch (e) { console.error('Postgres init failed (falling back to file):', e.message); pgPool = null; return null; }
}
async function saveDB() {
  if (USES_PG) {
    try {
      const p = await connectPg();
      if (p) {
        await p.query('INSERT INTO app_state(id,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()', ['app', JSON.stringify(db)]);
        return;
      }
    } catch (e) { console.error('Postgres save error (falling back to file):', e.message); }
  }
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error('save db error', e.message); }
}
async function loadDB() {
  if (USES_PG) {
    try {
      const p = await connectPg();
      if (p) {
        const r = await p.query('SELECT data FROM app_state WHERE id=$1', ['app']);
        if (r.rows && r.rows[0] && r.rows[0].data) { db = r.rows[0].data; console.log('[db] loaded state from Postgres'); return; }
        console.log('[db] Postgres connected but empty — will seed');
      }
    } catch (e) { console.error('Postgres load error (falling back to file):', e.message); }
  } else {
    console.log('[db] DATABASE_URL not set — using local file (resets on Render restart)');
  }
  try {
    if (fs.existsSync(DATA_FILE)) { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return; }
  } catch (e) { console.error('DB load error', e.message); }
  db = seedDB();
  await saveDB();
  console.log('[db] database was empty — seeded fresh logins/branches');
}
async function initStore() {
  if (USES_PG) await connectPg();
  await loadDB();
}

/* ------------------------------------------------------------- sessions ---- */
const sessions = new Map(); // token -> userId
function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, userId);
  return token;
}
function authToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function currentUser(req) {
  const t = authToken(req);
  const userId = t && sessions.get(t);
  return userId ? db.users.find(u => u.id === userId) : null;
}
function requireRole(roles) {
  return (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Not authenticated' });
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = u;
    next();
  };
}
/* ---------------------------------------------------------------- helpers --- */
function userOut(u) {
  return { id: u.id, role: u.role, username: u.username, name: u.name, branchId: u.branchId, phone: u.phone, generatedPassword: u.generatedPassword || null };
}
function branchOf(u) { return db.branches.find(b => b.id === u.branchId) || null; }
function scopeReports(u) {
  if (u.role === 'admin') return db.reports;
  if (!u.branchId) return [];
  return db.reports.filter(r => r.branchId === u.branchId);
}
function attachMeta(r) {
  const b = db.branches.find(x => x.id === r.branchId);
  return { ...r, branchName: b ? b.name : 'Unknown', pastorName: b ? b.pastor : '' };
}
/* ------------------------------------------------------------------ auth API */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.users.find(x => x.username && x.username.toLowerCase() === String(username || '').toLowerCase());
  if (!u || u.passwordHash !== sha(password || '')) return res.status(401).json({ error: 'Invalid username or password' });
  const token = newSession(u.id);
  io.emit('user:login', { username: u.username, name: u.name, role: u.role });
  res.json({ token, user: userOut(u) });
});
app.post('/api/logout', requireRole(null), (req, res) => {
  const t = authToken(req); if (t) sessions.delete(t);
  res.json({ ok: true });
});

// Any user (including admin) changes their own password securely
app.post('/api/me/password', requireRole(null), (req, res) => {
  const u = req.user;
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Current and new password are required' });
  if (String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  if (u.passwordHash !== sha256(current)) return res.status(400).json({ error: 'Current password is incorrect' });
  u.passwordHash = sha256(next);
  u.generatedPassword = next;
  saveDB();
  if (u.role === 'admin') io.emit('admin:users', db.users.map(userOut));
  res.json({ ok: true, user: userOut(u) });
});

/* ------------------------------------------------------------------ data --- */
app.get('/api/bootstrap', requireRole(null), (req, res) => {
  const u = req.user;
  const branches = db.branches.map(b => ({ id: b.id, name: b.name, pastor: b.pastor }));
  const reports = scopeReports(u).map(attachMeta);
  let users = [];
  if (u.role === 'admin') users = db.users.map(userOut);
  res.json({ user: userOut(u), branches, reports, users, months: MONTHS, days: DAYS, activities: ACTIVITIES });
});

/* ------------------------------------------------------------- reports ---- */
function emptyReport(branchId, branchName, createdBy) {
  return {
    id: uid('rp_'), branchId, branchName, status: 'submitted', createdBy: createdBy.name,
    month: '', sunday: [], weekday: [], finance: { tithes:'', sundayOfferings:'', weekdayOfferings:'', evangelismOffering:'', districtLevy:'', exchangeOfPulpit:'' },
    secretary: { name: createdBy.name, date: '', signature: null, signatureType: null },
    pastor: { name: '', date: '', signature: null, signatureType: null },
    createdAt: Date.now(), updatedAt: Date.now(), submittedAt: Date.now(), endorsedAt: null
  };
}

app.get('/api/reports', requireRole(null), (req, res) => {
  res.json(scopeReports(req.user).map(attachMeta));
});

app.get('/api/reports/:id', requireRole(null), (req, res) => {
  const r = db.reports.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  const u = req.user;
  if (u.role !== 'admin' && r.branchId !== u.branchId) return res.status(403).json({ error: 'Forbidden' });
  res.json(attachMeta(r));
});

// Secretary submits a new report -> lands in Pastor dashboard
app.post('/api/reports', requireRole(['secretary']), (req, res) => {
  const u = req.user; const body = req.body || {};
  const branch = branchOf(u) || db.branches.find(b => b.id === body.branchId);
  if (!branch) return res.status(400).json({ error: 'No branch assigned' });
  const r = emptyReport(branch.id, branch.name, u);
  r.branch = branch.name;
  r.month = body.month || '';
  r.pastor = body.pastor || r.pastor;
  r.sunday = body.sunday || [];
  r.weekday = body.weekday || [];
  r.finance = body.finance || r.finance;
  r.secretary = body.secretary || r.secretary;
  r.secretary.name = body.secretary?.name || u.name;
  r.updatedAt = Date.now(); r.submittedAt = Date.now();
  db.reports.push(r); saveDB();
  io.emit('report:submitted', attachMeta(r));
  res.status(201).json(attachMeta(r));
});

// Pastor saves their edited copy (still in review)
app.put('/api/reports/:id', requireRole(['secretary', 'pastor']), (req, res) => {
  const u = req.user; const r = db.reports.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (u.role !== 'admin' && r.branchId !== u.branchId) return res.status(403).json({ error: 'Forbidden' });
  const b = db.branches.find(x => x.id === r.branchId);
  const body = req.body || {};
  if (u.role === 'pastor') {
    r.sunday = body.sunday || r.sunday;
    r.weekday = body.weekday || r.weekday;
    r.finance = body.finance || r.finance;
    r.pastor = body.pastor || r.pastor;
    if (!r.pastor.name) r.pastor.name = b ? b.pastor : '';
    r.updatedAt = Date.now();
  } else {
    r.sunday = body.sunday || r.sunday;
    r.weekday = body.weekday || r.weekday;
    r.finance = body.finance || r.finance;
    r.secretary = body.secretary || r.secretary;
    r.secretary.name = body.secretary?.name || r.secretary.name;
    r.updatedAt = Date.now();
  }
  saveDB(); io.emit('report:updated', attachMeta(r));
  res.json(attachMeta(r));
});

// Pastor endorses -> lands in Admin dashboard
app.post('/api/reports/:id/endorse', requireRole(['pastor']), (req, res) => {
  const u = req.user; const r = db.reports.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.branchId !== u.branchId) return res.status(403).json({ error: 'Forbidden' });
  const body = req.body || {};
  r.pastor = body.pastor || r.pastor;
  if (!r.pastor.name) r.pastor.name = u.name;
  r.status = 'endorsed'; r.endorsedAt = Date.now(); r.updatedAt = Date.now();
  saveDB(); io.emit('report:endorsed', attachMeta(r));
  res.json(attachMeta(r));
});

/* ------------------------------------------------------------- analytics --- */
function llmConfig(){
  const cfg = db.llm || {};
  const envKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  return {
    apiKey: cfg.apiKey || envKey,
    baseUrl: (cfg.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/,''),
    model: cfg.model || process.env.LLM_MODEL || 'gpt-4o-mini',
    fromEnv: !!envKey
  };
}

async function generateInsights(analytics){
  const cfg = llmConfig();
  if (!cfg.apiKey) return { source:'rule', insights: analytics.insights, note:'' };
  const prompt = 'You are the district analytics assistant for ANLOGA DISTRICT RHEMA FULL GOSPEL CHURCHES. Based on this monthly-report summary JSON, write 4 concise, actionable, natural-language insights (one line each, no numbering or bullets) covering: total attendance health, the best-performing branch, the strongest revenue stream, and a practical recommendation. Data: ' + JSON.stringify({ totals:analytics.totals, finance:analytics.finance, byBranch:analytics.byBranch, totalReports:analytics.totalReports });
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(cfg.baseUrl + '/chat/completions', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages:[{ role:'user', content: prompt }], temperature:0.7, max_tokens:500 }),
      signal: controller.signal
    });
    clearTimeout(to);
    if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
    const data = await resp.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const insights = text.split(/\n/).map(s => s.replace(/^\s*[-•*\d.)]+\s*/,'').trim()).filter(s => s && s.length > 2);
    return insights.length ? { source:'llm', insights, note:'' } : { source:'rule', insights: analytics.insights, note:'' };
  } catch(e){
    return { source:'rule', insights: analytics.insights, note:'LLM unavailable: ' + e.message };
  }
}

app.get('/api/analytics', requireRole(['pastor', 'admin']), async (req, res) => {
  const u = req.user;
  let reps = scopeReports(u).map(attachMeta);
  const an = buildAnalytics(reps);
  const gen = await generateInsights(an);
  res.json({ ...an, insights: gen.insights, aiSource: gen.source, aiNote: gen.note || '', llmConfigured: !!llmConfig().apiKey });
});
function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function buildAnalytics(reps) {
  const totals = { children:0, youth:0, women:0, men:0, total:0 };
  let finance = { tithes:0, sundayOfferings:0, weekdayOfferings:0, evangelismOffering:0, districtLevy:0, exchangeOfPulpit:0, total:0 };
  const byBranch = {};
  reps.forEach(r => {
    const bt = byBranch[r.branch] || (byBranch[r.branch] = { branch: r.branch, total:0, count:0, offerings:0 });
    r.sunday.forEach(s => {
      const t = num(s.children)+num(s.youth)+num(s.women)+num(s.men);
      totals.children+=num(s.children); totals.youth+=num(s.youth); totals.women+=num(s.women); totals.men+=num(s.men); totals.total+=t;
      bt.total+=t; bt.count++;
    });
    const f = r.finance || {};
    Object.keys(finance).forEach(k=>{ if(k!=='total') finance[k]+=num(f[k]); });
    finance.total = finance.tithes+finance.sundayOfferings+finance.weekdayOfferings+finance.evangelismOffering+finance.districtLevy+finance.exchangeOfPulpit;
    bt.offerings += num(f.sundayOfferings)+num(f.weekdayOfferings);
  });
  const insights = [];
  const best = Object.values(byBranch).sort((a,b)=>b.total-a.total)[0];
  if (best) insights.push('Highest aggregate attendance: ' + best.branch + ' (' + best.total + ' persons across ' + best.count + ' recorded Sundays).');
  insights.push('Total recorded attendance across all Sundays: ' + totals.total + ' people.');
  insights.push('Total revenue reported: GH¢ ' + finance.total.toLocaleString() + '.');
  if (finance.tithes > finance.sundayOfferings) insights.push('Tithes (' + 'GH¢ ' + finance.tithes.toLocaleString() + ') currently exceed Sunday Offerings — strong commitment base.');
  else insights.push('Sunday Offerings lead the revenue streams; tithes follow at GH¢ ' + finance.tithes.toLocaleString() + '.');
  insights.push('Recommended focus: encourage men\'s & youth follow-up for balanced growth across all demographics.');
  return { totals, finance, byBranch: Object.values(byBranch), insights, totalReports: reps.length };
}

/* --------------------------------------------------------------- admin API */
app.get('/api/admin/branches', requireRole(['admin']), (req, res) => res.json(db.branches));
app.post('/api/admin/branches', requireRole(['admin']), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const br = { id: uid('br_'), name: b.name.trim(), pastor: (b.pastor || '').trim() };
  db.branches.push(br); saveDB(); io.emit('admin:branch', db.branches);
  res.status(201).json(br);
});
app.put('/api/admin/branches/:id', requireRole(['admin']), (req, res) => {
  const br = db.branches.find(x => x.id === req.params.id); if (!br) return res.status(404).json({error:'Not found'});
  br.name = (req.body.name || br.name).trim(); br.pastor = (req.body.pastor !== undefined ? req.body.pastor : br.pastor).trim();
  saveDB(); io.emit('admin:branch', db.branches); res.json(br);
});
app.delete('/api/admin/branches/:id', requireRole(['admin']), (req, res) => {
  db.branches = db.branches.filter(x => x.id !== req.params.id);
  saveDB(); io.emit('admin:branch', db.branches); res.json({ ok: true });
});

// Credentials (users) management
app.get('/api/admin/users', requireRole(['admin']), (req, res) => res.json(db.users.map(userOut)));
app.post('/api/admin/users', requireRole(['admin']), (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password) return res.status(400).json({ error: 'Username and password required' });
  if (db.users.find(x => x.username.toLowerCase() === String(b.username).toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
  const u = { id: uid('u_'), role: b.role === 'pastor' ? 'pastor' : 'secretary', username: String(b.username).trim(), passwordHash: sha256(b.password), generatedPassword: b.password, name: (b.name||'').trim(), branchId: b.branchId || null, phone: b.phone || '' };
  db.users.push(u); saveDB(); io.emit('admin:users', db.users.map(userOut));
  res.status(201).json(userOut(u));
});
app.put('/api/admin/users/:id', requireRole(['admin']), (req, res) => {
  const u = db.users.find(x => x.id === req.params.id); if (!u) return res.status(404).json({error:'Not found'});
  if (req.body.name !== undefined) u.name = req.body.name.trim();
  if (req.body.branchId !== undefined) u.branchId = req.body.branchId || null;
  if (req.body.phone !== undefined) u.phone = req.body.phone;
  if (req.body.password) { u.passwordHash = sha256(req.body.password); u.generatedPassword = req.body.password; }
  saveDB(); io.emit('admin:users', db.users.map(userOut)); res.json(userOut(u));
});
app.post('/api/admin/users/:id/reset', requireRole(['admin']), (req, res) => {
  const u = db.users.find(x => x.id === req.params.id); if (!u) return res.status(404).json({error:'Not found'});
  const np = randPass(); u.passwordHash = sha256(np); u.generatedPassword = np; saveDB();
  io.emit('admin:users', db.users.map(userOut)); res.json({ ...userOut(u), generatedPassword: np });
});
app.delete('/api/admin/users/:id', requireRole(['admin']), (req, res) => {
  if (req.params.id === 'u_admin') return res.status(400).json({ error: 'Cannot delete main admin' });
  db.users = db.users.filter(x => x.id !== req.params.id); saveDB();
  io.emit('admin:users', db.users.map(userOut)); res.json({ ok:true });
});
// helper re-slotting removed buggy line
function sha256(s){ return sha(s); }

// Admin AI settings (LLM config) — allows pasting a free OpenAI-compatible key
app.get('/api/admin/llm', requireRole(['admin']), (req, res) => {
  const cfg = llmConfig();
  res.json({ apiKeySet: !!cfg.apiKey, fromEnv: cfg.fromEnv, baseUrl: (db.llm||{}).baseUrl || '', model: (db.llm||{}).model || cfg.model });
});
app.put('/api/admin/llm', requireRole(['admin']), (req, res) => {
  db.llm = {
    apiKey: String(req.body.apiKey || '').trim(),
    baseUrl: String(req.body.baseUrl || '').trim(),
    model: String(req.body.model || '').trim()
  };
  saveDB();
  res.json({ ok:true, llmConfigured: !!llmConfig().apiKey });
});

/* ---------------------------------------------------------------- realtime -- */
io.on('connection', (socket) => {
  socket.on('register', (token) => {
    const userId = token && sessions.get(token);
    if (userId) socket.join('user:' + userId);
  });
});

function touchAll(){ io.emit('reports:change'); }

/* ------------------------------------------------------------------- boot -- */
initStore().then(() => {
  server.listen(PORT, () => console.log('RFGC Monthly Report app running on http://localhost:' + PORT));
  console.log('Developer: V. C. Gbetodeme | Contact: 0243302919');
}).catch((e) => {
  console.error('Init error, starting anyway:', e.message);
  server.listen(PORT, () => console.log('RFGC Monthly Report app running on http://localhost:' + PORT));
  console.log('Developer: V. C. Gbetodeme | Contact: 0243302919');
});