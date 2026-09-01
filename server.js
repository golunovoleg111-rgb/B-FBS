'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const XLSX = require('xlsx');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const CLOUD_PROVIDER = process.env.RAILWAY_ENVIRONMENT ? 'railway' : '';
const RAILWAY_VOLUME_DIR = String(process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
const DATA_DIR = path.resolve(process.env.BFBS_DATA_DIR || RAILWAY_VOLUME_DIR || path.join(ROOT, 'data'));
const DB_PATH = path.join(DATA_DIR, 'b-fbs.sqlite');
const PERSISTENT_STORAGE = CLOUD_PROVIDER !== 'railway' || !!(RAILWAY_VOLUME_DIR || process.env.BFBS_DATA_DIR);
const SESSION_TTL_MS = Number(process.env.BFBS_SESSION_HOURS || 24) * 60 * 60 * 1000;
const MAX_BODY = 10 * 1024 * 1024;
const ROLES = new Set(['admin', 'manager', 'picker', 'auditor']);
const PERMISSION_KEYS = [
  'dashboard_view','workspace_view','layout_manage','zones_manage',
  'inventory_view','inventory_manage','nomenclature_manage',
  'transfers_view','transfers_manage',
  'revisions_view','revisions_manage',
  'tasks_view','tasks_manage','tasks_pick'
];
const ALL_PERMISSIONS = Object.fromEntries(PERMISSION_KEYS.map(key=>[key,true]));
const ROLE_PERMISSION_DEFAULTS = {
  admin:{...ALL_PERMISSIONS},
  manager:{
    dashboard_view:true,workspace_view:true,layout_manage:true,zones_manage:true,
    inventory_view:true,inventory_manage:true,nomenclature_manage:true,
    transfers_view:true,transfers_manage:true,revisions_view:true,revisions_manage:true,
    tasks_view:true,tasks_manage:true,tasks_pick:true
  },
  picker:{
    dashboard_view:true,workspace_view:true,layout_manage:false,zones_manage:false,
    inventory_view:true,inventory_manage:false,nomenclature_manage:false,
    transfers_view:true,transfers_manage:true,revisions_view:false,revisions_manage:false,
    tasks_view:true,tasks_manage:false,tasks_pick:true
  },
  auditor:{
    dashboard_view:true,workspace_view:true,layout_manage:false,zones_manage:false,
    inventory_view:true,inventory_manage:false,nomenclature_manage:false,
    transfers_view:false,transfers_manage:false,revisions_view:true,revisions_manage:true,
    tasks_view:false,tasks_manage:false,tasks_pick:false
  }
};
const GOOGLE_SHEET_ID = process.env.BFBS_GOOGLE_SHEET_ID || '1oaf7MiFLdMpOI-syYOaJEeXpIyGRLzkGkUXvlMbJroU';
const GOOGLE_SHEET_GID = process.env.BFBS_GOOGLE_SHEET_GID || '0';

if(CLOUD_PROVIDER === 'railway' && !PERSISTENT_STORAGE){
  console.warn('[B-FBS] Railway volume is not attached. SQLite data will be ephemeral until a volume is mounted.');
}
fs.mkdirSync(DATA_DIR, {recursive:true});
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);
const userColumns = db.prepare('PRAGMA table_info(users)').all();
if(!userColumns.some(column=>column.name==='permissions_json')){
  db.exec("ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
}

function now(){ return new Date().toISOString(); }
function json(value){ return JSON.stringify(value); }
function parseJson(value, fallback){ try{return JSON.parse(value)}catch(_){return fallback} }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')){
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored){
  const [salt, expected] = String(stored || '').split(':');
  if(!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}
function defaultPermissions(role){
  return {...(ROLE_PERMISSION_DEFAULTS[role] || ROLE_PERMISSION_DEFAULTS.picker)};
}
function normalizePermissions(value, role){
  if(role==='admin') return {...ALL_PERMISSIONS};
  const base = defaultPermissions(role);
  if(value === undefined || value === null) return base;
  if(typeof value !== 'object' || Array.isArray(value)){
    throw Object.assign(new Error('Некорректные права доступа.'), {status:400});
  }
  const result = {...base};
  for(const key of PERMISSION_KEYS){
    if(Object.prototype.hasOwnProperty.call(value,key)) result[key]=!!value[key];
  }
  return result;
}
function effectivePermissions(row){
  if(!row) return defaultPermissions('picker');
  if(row.role==='admin') return {...ALL_PERMISSIONS};
  return normalizePermissions(parseJson(row.permissions_json,{}), row.role);
}
function hasPermission(row, key){
  return row?.role==='admin' || !!effectivePermissions(row)[key];
}
function publicUser(row){
  return row && {
    id:row.id, login:row.login, name:row.name, role:row.role,
    permissions:effectivePermissions(row),
    active:!!row.active, createdAt:row.created_at, updatedAt:row.updated_at, lastLoginAt:row.last_login_at
  };
}
function audit(userId, action, entityType = null, entityId = null, details = null){
  db.prepare('INSERT INTO audit_log(user_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
    .run(userId, action, entityType, entityId, details ? json(details) : null, now());
}

const admin = db.prepare('SELECT id FROM users WHERE login=?').get('Admin1');
if(!admin){
  if(CLOUD_PROVIDER && !process.env.BFBS_ADMIN_PASSWORD){
    throw new Error('BFBS_ADMIN_PASSWORD is required for the first cloud deployment.');
  }
  const timestamp = now();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users(id,login,name,role,password_hash,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)')
    .run(id, 'Admin1', 'Администратор', 'admin', passwordHash(process.env.BFBS_ADMIN_PASSWORD || 'Admin123'), timestamp, timestamp);
  audit(id, 'system.admin_seeded', 'user', id);
}
if(!db.prepare('SELECT id FROM app_state WHERE id=1').get()){
  db.prepare('INSERT INTO app_state(id,revision,payload,updated_at) VALUES(1,0,?,?)')
    .run(json({warehouses:null, workspace:null, wms:{nomenclature:[], boxes:[], transfers:[], revisions:[], tasks:[], movements:[], events:[]}}), now());
}
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());

function send(res, status, payload, headers = {}){
  const body = payload === null ? '' : json(payload);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers});
  res.end(body);
}
function readBody(req){
  return new Promise((resolve, reject)=>{
    let size = 0;
    const chunks = [];
    req.on('data', chunk=>{
      size += chunk.length;
      if(size > MAX_BODY){ reject(Object.assign(new Error('Слишком большой запрос.'), {status:413})); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', ()=>{
      if(!chunks.length){ resolve({}); return; }
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(_){reject(Object.assign(new Error('Некорректный JSON.'), {status:400}))}
    });
    req.on('error', reject);
  });
}
function bearer(req){
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function currentUser(req){
  const token = bearer(req);
  if(!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(crypto.createHash('sha256').update(token).digest('hex'), now());
  return row || null;
}
function requireUser(req, res, roles){
  const user = currentUser(req);
  if(!user){send(res, 401, {error:'Требуется авторизация.'});return null}
  if(roles && !roles.includes(user.role)){send(res, 403, {error:'Недостаточно прав.'});return null}
  return user;
}
function requirePermission(req, res, permission){
  const user = currentUser(req);
  if(!user){send(res,401,{error:'Требуется авторизация.'});return null}
  if(!hasPermission(user,permission)){send(res,403,{error:'Недостаточно прав для этой операции.',permission});return null}
  return user;
}
function sameJson(a,b){return json(a ?? null)===json(b ?? null)}
function workspaceZonesSnapshot(state){
  return {
    workspace:Array.isArray(state?.workspace?.zones)?state.workspace.zones:[],
    warehouses:(Array.isArray(state?.warehouses)?state.warehouses:[]).map(item=>({id:item?.id||'',zones:Array.isArray(item?.zones)?item.zones:[]}))
  };
}
function workspaceLayoutSnapshot(state){
  const workspace=state?.workspace && typeof state.workspace==='object' ? {...state.workspace} : state?.workspace;
  if(workspace && typeof workspace==='object') delete workspace.zones;
  const warehouses=(Array.isArray(state?.warehouses)?state.warehouses:[]).map(item=>{
    const copy={...(item||{})};delete copy.zones;delete copy.view;return copy;
  });
  return {workspace,warehouses};
}
function taskPickingDelta(currentTasks,nextTasks){
  if(!Array.isArray(currentTasks)||!Array.isArray(nextTasks)||currentTasks.length!==nextTasks.length)return null;
  const currentById=new Map(currentTasks.map(task=>[task.id,task])),deltaByBarcode=new Map();
  for(const next of nextTasks){
    const current=currentById.get(next.id);if(!current)return null;
    const strip=task=>{
      const copy={...task};delete copy.status;delete copy.startedAt;delete copy.readyAt;
      copy.lines=(task.lines||[]).map(line=>{const value={...line};delete value.picked;return value});
      return copy;
    };
    if(!sameJson(strip(current),strip(next)))return null;
    const allowedStatus=(current.status==='queued'&&['queued','working','ready'].includes(next.status))
      ||(current.status==='working'&&['working','ready'].includes(next.status));
    if(!allowedStatus)return null;
    const currentLines=current.lines||[],nextLines=next.lines||[];
    if(currentLines.length!==nextLines.length)return null;
    for(let i=0;i<nextLines.length;i++){
      const before=Number(currentLines[i].picked||0),after=Number(nextLines[i].picked||0);
      if(after<before || after>Number(nextLines[i].required||0))return null;
      const diff=after-before;
      if(diff)deltaByBarcode.set(String(nextLines[i].barcode||''),(deltaByBarcode.get(String(nextLines[i].barcode||''))||0)+diff);
    }
  }
  return deltaByBarcode;
}
function pickingInventoryOnly(currentWms,nextWms,pickedDelta){
  const currentBoxes=Array.isArray(currentWms?.boxes)?currentWms.boxes:[],nextBoxes=Array.isArray(nextWms?.boxes)?nextWms.boxes:[];
  if(currentBoxes.length!==nextBoxes.length)return false;
  const currentById=new Map(currentBoxes.map(box=>[box.id,box])),boxDelta=new Map();
  for(const next of nextBoxes){
    const current=currentById.get(next.id);if(!current)return false;
    const stripBox=box=>{
      const copy={...box};delete copy.updatedAt;
      copy.items=(box.items||[]).map(item=>{const value={...item};delete value.quantity;return value});
      return copy;
    };
    if(!sameJson(stripBox(current),stripBox(next)))return false;
    const currentItems=new Map((current.items||[]).map(item=>[String(item.barcode||''),item]));
    if(currentItems.size!==(next.items||[]).length)return false;
    for(const item of next.items||[]){
      const before=currentItems.get(String(item.barcode||''));if(!before)return false;
      const beforeQty=Number(before.quantity||0),afterQty=Number(item.quantity||0);
      if(afterQty>beforeQty||afterQty<0)return false;
      const diff=beforeQty-afterQty;
      if(diff)boxDelta.set(String(item.barcode||''),(boxDelta.get(String(item.barcode||''))||0)+diff);
    }
  }
  const keys=new Set([...pickedDelta.keys(),...boxDelta.keys()]);
  for(const key of keys){if((pickedDelta.get(key)||0)!==(boxDelta.get(key)||0))return false}
  return true;
}
function validateStatePermissions(user,currentState,nextState){
  const deny=permission=>{throw Object.assign(new Error('Недостаточно прав для изменения данных.'),{status:403,permission})};
  if(!sameJson(workspaceLayoutSnapshot(currentState),workspaceLayoutSnapshot(nextState))&&!hasPermission(user,'layout_manage'))deny('layout_manage');
  if(!sameJson(workspaceZonesSnapshot(currentState),workspaceZonesSnapshot(nextState))&&!hasPermission(user,'zones_manage'))deny('zones_manage');

  const currentWms=currentState?.wms||{},nextWms=nextState?.wms||{};
  const nomenclatureChanged=!sameJson(currentWms.nomenclature||[],nextWms.nomenclature||[]);
  const transfersChanged=!sameJson(currentWms.transfers||[],nextWms.transfers||[]);
  const revisionsChanged=!sameJson(currentWms.revisions||[],nextWms.revisions||[]);
  const tasksChanged=!sameJson(currentWms.tasks||[],nextWms.tasks||[]);
  const boxesChanged=!sameJson(currentWms.boxes||[],nextWms.boxes||[]);
  const movementsChanged=!sameJson(currentWms.movements||[],nextWms.movements||[]);

  if(nomenclatureChanged&&!hasPermission(user,'nomenclature_manage'))deny('nomenclature_manage');
  if(transfersChanged&&!hasPermission(user,'transfers_manage'))deny('transfers_manage');
  if(revisionsChanged&&!hasPermission(user,'revisions_manage'))deny('revisions_manage');

  let pickingDelta=null,pickingOnly=false;
  if(tasksChanged){
    pickingDelta=taskPickingDelta(currentWms.tasks||[],nextWms.tasks||[]);
    pickingOnly=!!pickingDelta&&hasPermission(user,'tasks_pick');
    if(!pickingOnly&&!hasPermission(user,'tasks_manage'))deny('tasks_manage');
  }
  if(boxesChanged){
    const pickingBoxes=pickingOnly&&pickingInventoryOnly(currentWms,nextWms,pickingDelta);
    const relatedOperation=(transfersChanged&&hasPermission(user,'transfers_manage'))||(revisionsChanged&&hasPermission(user,'revisions_manage'));
    if(!pickingBoxes&&!relatedOperation&&!hasPermission(user,'inventory_manage'))deny('inventory_manage');
  }
  if(movementsChanged&&!boxesChanged&&!hasPermission(user,'inventory_manage')&&!pickingOnly&&!transfersChanged&&!revisionsChanged)deny('inventory_manage');
}
function validateUserInput(body, editing = false){
  const login = String(body.login || '').trim();
  const name = String(body.name || '').trim();
  const role = String(body.role || '').trim();
  const password = String(body.password || '');
  if(!login || login.length < 3 || login.length > 64) throw Object.assign(new Error('Логин должен содержать от 3 до 64 символов.'), {status:400});
  if(!/^[\p{L}\p{N}_.@-]+$/u.test(login)) throw Object.assign(new Error('Логин содержит недопустимые символы.'), {status:400});
  if(!name || name.length > 100) throw Object.assign(new Error('Укажите имя сотрудника.'), {status:400});
  if(!ROLES.has(role)) throw Object.assign(new Error('Неизвестная роль.'), {status:400});
  if((!editing || password) && password.length < 8) throw Object.assign(new Error('Пароль должен содержать минимум 8 символов.'), {status:400});
  return {login, name, role, password};
}

function normalizeImportedState(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)){
    throw Object.assign(new Error('Резервная копия не содержит состояние B-FBS.'), {status:400});
  }
  const warehouses = value.warehouses == null ? null : value.warehouses;
  if(warehouses !== null && !Array.isArray(warehouses)){
    throw Object.assign(new Error('Некорректный список складов в резервной копии.'), {status:400});
  }
  const workspace = value.workspace == null ? null : value.workspace;
  if(workspace !== null && (typeof workspace !== 'object' || Array.isArray(workspace))){
    throw Object.assign(new Error('Некорректные данные рабочего пространства.'), {status:400});
  }
  if(!value.wms || typeof value.wms !== 'object' || Array.isArray(value.wms)){
    throw Object.assign(new Error('В резервной копии отсутствуют складские данные WMS.'), {status:400});
  }
  const rawWms = value.wms;
  const arrays = ['nomenclature','boxes','transfers','revisions','tasks','movements','events'];
  const wms = {...rawWms};
  arrays.forEach(key=>{wms[key]=Array.isArray(rawWms[key])?rawWms[key]:[]});
  if(wms.nomenclature.length > 200000 || wms.boxes.length > 100000 || wms.movements.length > 100000){
    throw Object.assign(new Error('Резервная копия превышает допустимый объем данных.'), {status:400});
  }
  return {warehouses, workspace, wms};
}
function stateSummary(state){
  const warehouses = Array.isArray(state?.warehouses) ? state.warehouses : [];
  const wms = state?.wms || {};
  const boxes = Array.isArray(wms.boxes) ? wms.boxes : [];
  return {
    warehouses:warehouses.length,
    zones:warehouses.reduce((sum,item)=>sum+(Array.isArray(item?.zones)?item.zones.length:0),0),
    nomenclature:Array.isArray(wms.nomenclature)?wms.nomenclature.length:0,
    boxes:boxes.length,
    units:boxes.reduce((sum,box)=>sum+(Array.isArray(box?.items)?box.items.reduce((inner,item)=>inner+Math.max(0,Number(item?.quantity)||0),0):0),0),
    movements:Array.isArray(wms.movements)?wms.movements.length:0,
    tasks:Array.isArray(wms.tasks)?wms.tasks.length:0,
    revisions:Array.isArray(wms.revisions)?wms.revisions.length:0
  };
}

async function googleSummaryItems(){
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 8000);
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(GOOGLE_SHEET_ID)}/export?format=csv&gid=${encodeURIComponent(GOOGLE_SHEET_GID)}`;
  let response;
  try{
    response = await fetch(url, {signal:controller.signal, redirect:'follow', headers:{'User-Agent':'B-FBS/1.0'}});
  }finally{
    clearTimeout(timeout);
  }
  if(!response.ok) throw Object.assign(new Error(`Google Sheets вернул ошибку ${response.status}.`), {status:502});
  const text = await response.text();
  if(!text.trim() || /<html[\s>]/i.test(text.slice(0,500))){
    throw Object.assign(new Error('Таблица Google Sheets недоступна без авторизации. Откройте доступ по ссылке или настройте серверный доступ.'), {status:502});
  }
  let workbook;
  try{workbook = XLSX.read(text, {type:'string', raw:false})}catch(_){throw Object.assign(new Error('Не удалось прочитать «Сводную» Google Sheets.'), {status:502})}
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, {header:1, raw:false, defval:''}) : [];
  const items = new Map();
  rows.forEach(row=>{
    const barcode = String(row?.[0] || '').replace(/\.0$/, '').trim();
    if(!/^\d{8,20}$/.test(barcode)) return;
    const article = String(row?.[1] || '').trim();
    const size = String(row?.[4] || '').trim();
    const packed = Number(String(row?.[9] || '0').replace(/\s/g,'').replace(',','.')) || 0;
    const key = [barcode,article,size].join('|');
    const existing = items.get(key) || {barcode,article,size,packed:0};
    existing.packed += packed;
    items.set(key,existing);
  });
  return [...items.values()].sort((a,b)=>String(a.article).localeCompare(String(b.article),'ru')||String(a.size).localeCompare(String(b.size),'ru'));
}

async function api(req, res, pathname){
  if(req.method === 'GET' && pathname === '/api/health'){
    const stateRow = db.prepare('SELECT revision,updated_at FROM app_state WHERE id=1').get();
    send(res, 200, {
      ok:true,
      service:'B-FBS',
      database:'sqlite',
      storage:PERSISTENT_STORAGE?'persistent':'ephemeral',
      cloud:CLOUD_PROVIDER||'local',
      revision:Number(stateRow?.revision||0),
      stateUpdatedAt:stateRow?.updated_at||null,
      time:now(),
      wbConfigured:!!process.env.WB_API_TOKEN
    });
    return;
  }
  if(req.method === 'POST' && pathname === '/api/auth/login'){
    const body = await readBody(req);
    const login = String(body.login || '').trim();
    const user = db.prepare('SELECT * FROM users WHERE login=? COLLATE NOCASE').get(login);
    if(!user || !user.active || !verifyPassword(body.password, user.password_hash)){
      audit(user?.id || null, 'auth.login_failed', 'user', user?.id || login);
      send(res, 401, {error:'Неверный логин или пароль.'});
      return;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const timestamp = now();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), user.id, timestamp, expiresAt);
    db.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, user.id);
    audit(user.id, 'auth.login', 'user', user.id);
    send(res, 200, {token, expiresAt, user:publicUser({...user,last_login_at:timestamp,updated_at:timestamp})});
    return;
  }
  if(req.method === 'GET' && pathname === '/api/auth/session'){
    const user = requireUser(req, res); if(!user)return;
    send(res, 200, {user:publicUser(user)}); return;
  }
  if(req.method === 'POST' && pathname === '/api/auth/logout'){
    const user = currentUser(req);
    const token = bearer(req);
    if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
    if(user) audit(user.id, 'auth.logout', 'user', user.id);
    send(res, 200, {ok:true}); return;
  }

  if(req.method === 'GET' && pathname === '/api/users'){
    const user = requireUser(req, res, ['admin']); if(!user)return;
    const rows = db.prepare('SELECT * FROM users ORDER BY active DESC,name COLLATE NOCASE').all();
    send(res, 200, {users:rows.map(publicUser)}); return;
  }
  if(req.method === 'POST' && pathname === '/api/users'){
    const actor = requireUser(req, res, ['admin']); if(!actor)return;
    const body = await readBody(req);
    const input = validateUserInput(body);
    const permissions = normalizePermissions(body.permissions,input.role);
    const id = crypto.randomUUID(), timestamp = now();
    try{
      db.prepare('INSERT INTO users(id,login,name,role,password_hash,permissions_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
        .run(id,input.login,input.name,input.role,passwordHash(input.password),json(permissions),timestamp,timestamp);
    }catch(error){
      if(String(error.message).includes('UNIQUE')){send(res,409,{error:'Пользователь с таким логином уже существует.'});return}
      throw error;
    }
    audit(actor.id, 'user.created', 'user', id, {login:input.login,role:input.role});
    send(res, 201, {user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id))}); return;
  }
  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if(userMatch && req.method === 'PATCH'){
    const actor = requireUser(req, res, ['admin']); if(!actor)return;
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(decodeURIComponent(userMatch[1]));
    if(!existing){send(res,404,{error:'Пользователь не найден.'});return}
    const body = await readBody(req);
    const input = validateUserInput({...existing,...body}, true);
    const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
    if(existing.id === actor.id && !active){send(res,400,{error:'Нельзя отключить собственную учетную запись.'});return}
    if(String(existing.login).toLowerCase()==='admin1'&&input.role!=='admin'){send(res,400,{error:'Основного администратора Admin1 нельзя лишить роли администратора.'});return}
    const roleChanged=input.role!==existing.role;
    const permissions=normalizePermissions(
      body.permissions===undefined?(roleChanged?undefined:parseJson(existing.permissions_json,{})):body.permissions,
      input.role
    );
    try{
      if(input.password){
        db.prepare('UPDATE users SET login=?,name=?,role=?,permissions_json=?,active=?,password_hash=?,updated_at=? WHERE id=?')
          .run(input.login,input.name,input.role,json(permissions),active,passwordHash(input.password),now(),existing.id);
      }else{
        db.prepare('UPDATE users SET login=?,name=?,role=?,permissions_json=?,active=?,updated_at=? WHERE id=?')
          .run(input.login,input.name,input.role,json(permissions),active,now(),existing.id);
      }
    }catch(error){
      if(String(error.message).includes('UNIQUE')){send(res,409,{error:'Пользователь с таким логином уже существует.'});return}
      throw error;
    }
    audit(actor.id, 'user.updated', 'user', existing.id, {role:input.role,active:!!active,permissions});
    send(res, 200, {user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(existing.id))}); return;
  }

  if(req.method === 'GET' && pathname === '/api/state'){
    const user = requireUser(req, res); if(!user)return;
    const row = db.prepare('SELECT * FROM app_state WHERE id=1').get();
    send(res, 200, {revision:row.revision,state:parseJson(row.payload,{}),updatedAt:row.updated_at,user:publicUser(user)}); return;
  }
  if(req.method === 'PUT' && pathname === '/api/state'){
    const user = requireUser(req, res); if(!user)return;
    const body = await readBody(req);
    if(!body.state || typeof body.state !== 'object' || Array.isArray(body.state)){send(res,400,{error:'Некорректное состояние системы.'});return}
    const current = db.prepare('SELECT revision,payload FROM app_state WHERE id=1').get();
    if(Number.isInteger(body.revision) && body.revision !== current.revision){
      send(res,409,{error:'Данные были изменены другим сотрудником.',revision:current.revision});return;
    }
    try{validateStatePermissions(user,parseJson(current.payload,{}),body.state)}
    catch(error){send(res,error.status||403,{error:error.message,permission:error.permission||null});return}
    const revision = current.revision + 1, timestamp = now();
    db.prepare('UPDATE app_state SET revision=?,payload=?,updated_at=?,updated_by=? WHERE id=1')
      .run(revision,json(body.state),timestamp,user.id);
    audit(user.id, 'state.updated', 'state', 'main', {revision});
    send(res,200,{ok:true,revision,updatedAt:timestamp});return;
  }
  if(req.method === 'POST' && pathname === '/api/state/import-backup'){
    const user = requireUser(req, res, ['admin']); if(!user)return;
    const body = await readBody(req);
    let imported;
    try{imported = normalizeImportedState(body.state)}catch(error){send(res,error.status||400,{error:error.message});return}
    const current = db.prepare('SELECT revision FROM app_state WHERE id=1').get();
    if(Number.isInteger(body.revision) && body.revision !== current.revision){
      send(res,409,{error:'Центральная база изменилась после открытия импорта. Обновите данные и повторите.',revision:current.revision});return;
    }
    const revision = current.revision + 1, timestamp = now(), summary = stateSummary(imported);
    db.prepare('UPDATE app_state SET revision=?,payload=?,updated_at=?,updated_by=? WHERE id=1')
      .run(revision,json(imported),timestamp,user.id);
    audit(user.id, 'state.backup_imported', 'state', 'main', {revision,...summary});
    send(res,200,{ok:true,revision,updatedAt:timestamp,summary});return;
  }
  if(req.method === 'GET' && pathname === '/api/audit'){
    const user = requireUser(req, res, ['admin','manager']); if(!user)return;
    const rows = db.prepare(`SELECT a.*,u.login,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
      ORDER BY a.id DESC LIMIT 300`).all();
    send(res,200,{events:rows.map(row=>({id:row.id,userId:row.user_id,login:row.login,name:row.name,action:row.action,entityType:row.entity_type,entityId:row.entity_id,details:parseJson(row.details,null),createdAt:row.created_at}))});return;
  }
  if(req.method === 'GET' && pathname === '/api/export'){
    const user = requireUser(req, res, ['admin']); if(!user)return;
    const state = db.prepare('SELECT * FROM app_state WHERE id=1').get();
    const users = db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser);
    audit(user.id, 'system.export', 'state', 'main');
    send(res,200,{exportedAt:now(),revision:state.revision,state:parseJson(state.payload,{}),users});return;
  }
  if(req.method === 'GET' && pathname === '/api/wb/status'){
    const user = requireUser(req, res, ['admin','manager']); if(!user)return;
    send(res,200,{configured:!!process.env.WB_API_TOKEN,message:process.env.WB_API_TOKEN?'Ключ задан на сервере.':'Задайте WB_API_TOKEN в окружении сервера.'});return;
  }
  if(req.method === 'GET' && pathname === '/api/google-sheet/summary'){
    const user = requirePermission(req, res, 'inventory_view'); if(!user)return;
    try{
      const items = await googleSummaryItems();
      send(res,200,{items,spreadsheetId:GOOGLE_SHEET_ID,gid:GOOGLE_SHEET_GID,updatedAt:now()});
    }catch(error){
      send(res,error.status||502,{error:error.message||'Не удалось получить Google Sheets.'});
    }
    return;
  }
  if(req.method === 'POST' && pathname === '/api/import/preview'){
    const user = requirePermission(req, res, 'nomenclature_manage'); if(!user)return;
    const body = await readBody(req);
    const name = String(body.name || 'import.xlsx');
    if(!/\.xlsx?$/i.test(name)){send(res,400,{error:'Поддерживаются только файлы Excel XLSX/XLS.'});return}
    let buffer;
    try{buffer = Buffer.from(String(body.data || ''), 'base64')}catch(_){send(res,400,{error:'Не удалось прочитать файл.'});return}
    if(!buffer.length || buffer.length > MAX_BODY){send(res,400,{error:'Файл пуст или слишком большой.'});return}
    let workbook;
    try{workbook = XLSX.read(buffer, {type:'buffer', cellDates:false})}catch(_){send(res,400,{error:'Не удалось открыть Excel-файл.'});return}
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet){send(res,400,{error:'В книге нет листов.'});return}
    const rows = XLSX.utils.sheet_to_json(sheet, {header:1, raw:false, defval:''}).slice(0, 100001);
    audit(user.id, 'nomenclature.import_preview', 'file', name, {rows:Math.max(0, rows.length - 1)});
    send(res,200,{rows});return;
  }
  send(res,404,{error:'API-метод не найден.'});
}

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const PUBLIC_FILES = new Set(['index.html','styles.css','editor-fixes.css','workspace-v4.css','workspace-v5.css','workspace-v6.css','wms-final.css','ui-v2.css','app.js','workspace-hotfix.js','workspace-v4.js','workspace-v5.js','workspace-v6.js','wms-final.js','ui-v2.js','manifest.webmanifest','sw.js','vendor/qrcode.min.js','vendor/xlsx.full.min.js']);
function staticFile(req, res, pathname){
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  if(!requested || !PUBLIC_FILES.has(requested)){
    send(res,404,{error:'Файл не найден.'});return;
  }
  const file = path.resolve(ROOT, requested);
  if(!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT,'index.html')){send(res,403,{error:'Доступ запрещён.'});return}
  let stat;
  try{stat=fs.statSync(file)}catch(_){send(res,404,{error:'Файл не найден.'});return}
  if(!stat.isFile()){send(res,404,{error:'Файл не найден.'});return}
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200,{
    'Content-Type':type,
    'Content-Length':stat.size,
    'Cache-Control':requested === 'index.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://docs.google.com"
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req,res)=>{
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try{
    if(requestUrl.pathname.startsWith('/api/')) await api(req,res,requestUrl.pathname);
    else if(req.method === 'GET' || req.method === 'HEAD') staticFile(req,res,requestUrl.pathname);
    else send(res,405,{error:'Метод не поддерживается.'},{Allow:'GET, HEAD, POST, PUT, PATCH'});
  }catch(error){
    console.error(error);
    if(!res.headersSent) send(res,error.status || 500,{error:error.status ? error.message : 'Внутренняя ошибка сервера.'});
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`B-FBS server: http://0.0.0.0:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Storage: ${PERSISTENT_STORAGE?'persistent':'ephemeral'}${CLOUD_PROVIDER?` (${CLOUD_PROVIDER})`:''}`);
});

let shuttingDown=false;
function shutdown(signal){
  if(shuttingDown)return;
  shuttingDown=true;
  console.log(`[B-FBS] ${signal}: graceful shutdown`);
  server.close(()=>{
    try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)')}catch(_){}
    try{db.close()}catch(_){}
    process.exit(0);
  });
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
