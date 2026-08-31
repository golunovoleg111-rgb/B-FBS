const AUTH_KEY = 'b-fbs-auth';
const ADMIN_LOGIN = 'Admin1';
const ADMIN_PASSWORD = 'Admin123';
const TABS = [
  ['dashboard', 'Главный экран'], ['workspace', 'Рабочее пространство'], ['inventory', 'Учет склада'],
  ['transfer', 'Заявка на перемещение'], ['revision', 'Ревизия'], ['account', 'Личный кабинет'], ['tasks', 'Сборочное задание']
];
const VIEWPORT_W = 1000;
const VIEWPORT_H = 500;
const OBJECT_TYPES = {
  'Вход': { cls: 'entrance', icon: '↔' },
  'Рабочая зона сборщиков': { cls: 'work', icon: '▦' },
  'Место для коробок': { cls: 'boxes', icon: '▤' },
  'Место для мусора': { cls: 'trash', icon: '♻' },
  'Окно': { cls: 'window', icon: '▥' },
  'Ворота': { cls: 'gate', icon: '⇆' },
  'Перегородка': { cls: 'partition', icon: '│' }
};
const root = document.getElementById('root');
let activeTab = 'dashboard';
let workspaceMode = 'design';
let tool = 'select';
let pointerAction = null;
let draft = { walls: [], objects: [] };
let published = null;
let zones = [];
let view = { zoom: 1, panX: 0, panY: 0 };

function loginView() {
  root.innerHTML = `<main class="login"><section class="card"><div class="login-mark">B</div><div class="eyebrow">B-FBS</div><h1>Вход в систему</h1><p class="desc">Складская рабочая система</p><form class="form" id="login-form"><label>Логин<input id="login" autocomplete="username" required></label><label>Пароль<input id="password" type="password" autocomplete="current-password" required></label><div id="login-error"></div><button class="btn primary" type="submit">Войти</button></form></section></main>`;
  document.getElementById('login-form').onsubmit = e => {
    e.preventDefault();
    if (login.value === ADMIN_LOGIN && password.value === ADMIN_PASSWORD) { sessionStorage.setItem(AUTH_KEY, 'admin'); render(); }
    else document.getElementById('login-error').innerHTML = '<div class="error">Неверный логин или пароль</div>';
  };
}

function dashboardView() {
  return `<div class="dashboard"><div class="welcome"><div><h2>Оперативная сводка</h2><p>Ключевые показатели склада за текущий момент.</p></div><div class="date">WB API: не подключен</div></div><div class="metrics"><div class="metric"><div class="metric-label">Заказы</div><div class="metric-value">0</div><div class="metric-note">Актуальные заказы на WB</div></div><div class="metric"><div class="metric-label">Готовые задания</div><div class="metric-value">0</div><div class="metric-note">Ожидают сборки</div></div><div class="metric"><div class="metric-label">Завершенные</div><div class="metric-value">0</div><div class="metric-note">Отгружены и закрыты</div></div><div class="metric"><div class="metric-label">Остатки</div><div class="metric-value">0</div><div class="metric-note">Единиц товара на складе</div></div></div><div class="panels"><div class="panel"><div class="panel-head"><div class="panel-title">Состояние сборки</div><div class="panel-link">Сегодня</div></div><div class="status-list"><div class="status-row"><span>В очереди</span><b>0</b></div><div class="status-row"><span>В работе</span><b>0</b></div><div class="status-row"><span>Готово к отгрузке</span><b>0</b></div></div></div><div class="panel"><div class="panel-head"><div class="panel-title">Последние события</div></div><div class="empty-panel">Событий пока нет</div></div></div></div>`;
}

function workspaceView() {
  const isDesign = workspaceMode === 'design';
  const source = published || draft;
  return `<div class="workspace"><div class="workspace-head"><div><h2>${isDesign ? 'Проектирование склада' : 'Склад'}</h2><p>${isDesign ? 'Создайте визуальный макет склада. Для больших объектов используйте масштаб и перемещение полотна.' : 'Опубликованная схема склада. Изменение схемы создаёт отдельную копию и не меняет отображение сотрудников.'}</p></div><div class="design-actions">${isDesign ? '<span class="draft-badge">Черновик</span>' : '<span class="saved-badge">Опубликованная схема</span>'}</div></div><div class="workspace-grid"><aside class="tool-panel panel">${isDesign ? designPanel() : managementPanel()}</aside><div class="canvas-wrap panel"><div class="canvas-toolbar"><div class="canvas-title">План склада · ${isDesign ? 'режим проектирования' : 'рабочая схема'}</div><div class="zoom-controls"><button id="zoom-out" title="Уменьшить">−</button><span id="zoom-value">${Math.round(view.zoom * 100)}%</span><button id="zoom-in" title="Увеличить">+</button><button id="zoom-reset" title="Сбросить масштаб">100%</button><button id="zoom-fit" title="Показать весь план">Вписать</button></div></div><div class="floor" id="floor"><svg class="warehouse-svg" id="warehouse-svg" viewBox="${view.panX} ${view.panY} ${VIEWPORT_W / view.zoom} ${VIEWPORT_H / view.zoom}" preserveAspectRatio="none">${renderGrid()}${renderWalls(source.walls)}</svg><div class="world-objects" id="world-objects">${renderObjects(source.objects)}${zones.map((z,i)=>`<div class="zone" data-zone="${i}" style="left:${z.x / (VIEWPORT_W / view.zoom) * 100}%;top:${z.y / (VIEWPORT_H / view.zoom) * 100}%;width:${z.w / (VIEWPORT_W / view.zoom) * 100}%;height:${z.h / (VIEWPORT_H / view.zoom) * 100}%"><b>${z.name}</b><small>${z.capacity} ящиков</small><button>Открыть</button></div>`).join('')}</div>${!source.walls.length && !source.objects.length ? '<div class="floor-note">Выберите «Линия» или «Прямоугольник»<br><small>и нарисуйте границы склада</small></div>' : ''}</div><div class="canvas-help">Колесо мыши — масштаб · Средняя кнопка или пробел + ЛКМ — перемещение полотна</div></div></div></div>`;
}

function designPanel() {
  return `<div class="panel-title">Этап проектирования · 01 Стены</div><p class="hint">Создайте каркас склада. Рабочая область поддерживает масштабирование и перемещение для больших объектов.</p><div class="tool-buttons"><button class="tool ${tool === 'select' ? 'active' : ''}" data-tool="select">Выбор</button><button class="tool ${tool === 'line' ? 'active' : ''}" data-tool="line">Линия</button><button class="tool ${tool === 'rectangle' ? 'active' : ''}" data-tool="rectangle">Прямоугольник</button><button class="tool ${tool === 'eraser' ? 'active' : ''}" data-tool="eraser">Ластик</button></div><div class="legend"><span>ЛКМ + движение — рисование</span><span>Ластик — удалить стену или объект</span><span>Выбор — перемещение объектов</span><span>Угол объекта — изменение размера</span></div><div class="object-section"><div class="panel-title">Этап проектирования · 02 Объекты</div><p class="hint">Объекты второстепенны на схеме и имеют индивидуальные визуальные обозначения.</p><div class="object-buttons">${Object.keys(OBJECT_TYPES).map(x => `<button class="object-btn" data-object="${x}"><span class="object-icon ${OBJECT_TYPES[x].cls}">${OBJECT_TYPES[x].icon}</span><span>${x}</span></button>`).join('')}</div></div><button class="btn primary wide" id="save-design">Сохранить изменения</button>`;
}

function managementPanel() {
  return `<div class="panel-title">Управление складом</div><p class="hint">Проектирование завершено. Сотрудники видят опубликованную схему. Только администратор может создать её новую копию.</p><button class="btn wide" id="edit-copy">Создать копию для редактирования</button><div class="object-section"><div class="panel-title">Зоны хранения</div><p class="hint">Зоны размещаются после публикации схемы. На этапе проектирования они недоступны.</p><div class="zone-form"><label>Название зоны<input id="zone-name" placeholder="Например, Зона A"></label><label>Вместимость ящиков<input id="zone-capacity" type="number" min="1" placeholder="100"></label><button class="btn primary wide" id="add-zone">Добавить зону</button></div></div>`;
}

function renderGrid() {
  const step = 50, maxX = VIEWPORT_W / view.zoom + view.panX, maxY = VIEWPORT_H / view.zoom + view.panY;
  let html = '';
  const sx = Math.floor(view.panX / step) * step;
  const sy = Math.floor(view.panY / step) * step;
  for (let x = sx; x <= maxX; x += step) html += `<line class="grid-line" x1="${x}" y1="${view.panY}" x2="${x}" y2="${maxY}"/>`;
  for (let y = sy; y <= maxY; y += step) html += `<line class="grid-line" x1="${view.panX}" y1="${y}" x2="${maxX}" y2="${y}"/>`;
  return html;
}

function renderWalls(walls) {
  return walls.map((w,i) => w.type === 'line' ? `<line class="wall wall-line" data-wall-id="${i}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"/>` : `<rect class="wall wall-rect" data-wall-id="${i}" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}"/>`).join('');
}

function renderObjects(objects) {
  const visibleW = VIEWPORT_W / view.zoom, visibleH = VIEWPORT_H / view.zoom;
  return objects.map((o,i) => { const type = OBJECT_TYPES[o.name] || OBJECT_TYPES['Перегородка']; return `<div class="placed-object ${type.cls}" data-object-id="${i}" style="left:${(o.x - view.panX) / visibleW * 100}%;top:${(o.y - view.panY) / visibleH * 100}%;width:${o.w / visibleW * 100}%;height:${o.h / visibleH * 100}%"><span class="object-symbol">${type.icon}</span><span>${o.name}</span><button class="remove-object" data-remove="${i}" aria-label="Удалить">×</button><i class="resize-handle"></i></div>`; }).join('');
}

function point(e, el) {
  const r = el.getBoundingClientRect(), visibleW = VIEWPORT_W / view.zoom, visibleH = VIEWPORT_H / view.zoom;
  return { x: view.panX + ((e.clientX - r.left) / r.width) * visibleW, y: view.panY + ((e.clientY - r.top) / r.height) * visibleH };
}

function clampPan() {
  const visibleW = VIEWPORT_W / view.zoom, visibleH = VIEWPORT_H / view.zoom;
  const maxX = Math.max(0, VIEWPORT_W - visibleW), maxY = Math.max(0, VIEWPORT_H - visibleH);
  view.panX = Math.max(0, Math.min(maxX, view.panX)); view.panY = Math.max(0, Math.min(maxY, view.panY));
}

function setZoom(next, focus = null) {
  const old = view.zoom; view.zoom = Math.max(0.25, Math.min(3, next));
  if (focus) { const r = floor.getBoundingClientRect(); const fx = (focus.clientX - r.left) / r.width, fy = (focus.clientY - r.top) / r.height; view.panX += fx * (VIEWPORT_W / old - VIEWPORT_W / view.zoom); view.panY += fy * (VIEWPORT_H / old - VIEWPORT_H / view.zoom); }
  clampPan(); render();
}

function bindWorkspace() {
  const floor = document.getElementById('floor');
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { tool = b.dataset.tool; render(); });
  document.getElementById('zoom-out').onclick = () => setZoom(view.zoom - 0.25);
  document.getElementById('zoom-in').onclick = () => setZoom(view.zoom + 0.25);
  document.getElementById('zoom-reset').onclick = () => { view = { zoom: 1, panX: 0, panY: 0 }; render(); };
  document.getElementById('zoom-fit').onclick = () => { view = { zoom: 1, panX: 0, panY: 0 }; render(); };
  floor.onwheel = e => { e.preventDefault(); setZoom(view.zoom + (e.deltaY < 0 ? 0.25 : -0.25), e); };
  floor.onpointerdown = e => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) { pointerAction = { mode: 'pan', startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY }; floor.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0 || workspaceMode !== 'design') return;
    if (e.target.closest('.placed-object') || tool === 'select') return;
    const p = point(e, floor); pointerAction = { mode: tool, start: p }; floor.setPointerCapture(e.pointerId);
  };
  floor.onpointermove = e => {
    if (!pointerAction) return;
    if (pointerAction.mode === 'pan') { const visibleW = VIEWPORT_W / view.zoom, visibleH = VIEWPORT_H / view.zoom; view.panX = pointerAction.panX - (e.clientX - pointerAction.startX) / floor.clientWidth * visibleW; view.panY = pointerAction.panY - (e.clientY - pointerAction.startY) / floor.clientHeight * visibleH; clampPan(); render(); return; }
  };
  floor.onpointerup = e => {
    if (!pointerAction) return;
    if (pointerAction.mode === 'pan') { pointerAction = null; return; }
    if (workspaceMode !== 'design') { pointerAction = null; return; }
    const p = point(e, floor), s = pointerAction.start, x = Math.min(s.x,p.x), y = Math.min(s.y,p.y), w = Math.abs(p.x-s.x), h = Math.abs(p.y-s.y);
    if (pointerAction.mode === 'line' && w + h > 5) draft.walls.push({ type:'line', x1:s.x, y1:s.y, x2:p.x, y2:p.y });
    if (pointerAction.mode === 'rectangle' && w > 5 && h > 5) draft.walls.push({ type:'rect', x,y,w,h });
    pointerAction = null; render();
  };
  document.querySelectorAll('.wall').forEach(el => el.onclick = e => { if (tool === 'eraser') { draft.walls.splice(Number(el.dataset.wallId),1); render(); } });
  document.querySelectorAll('[data-object]').forEach(b => b.onclick = () => { const i = draft.objects.length; draft.objects.push({name:b.dataset.object,x:80+(i%4)*180,y:80+Math.floor(i/4)*110,w:150,h:70}); render(); });
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = e => { e.stopPropagation(); draft.objects.splice(Number(b.dataset.remove),1); render(); });
  bindObjectDrag(floor, draft.objects);
  document.getElementById('save-design').onclick = () => { published = JSON.parse(JSON.stringify(draft)); workspaceMode='management'; view={zoom:1,panX:0,panY:0}; render(); };
  if (workspaceMode !== 'design') {
    document.getElementById('edit-copy').onclick = () => { draft = JSON.parse(JSON.stringify(published)); workspaceMode='design'; view={zoom:1,panX:0,panY:0}; render(); };
    document.getElementById('add-zone').onclick = () => { const name=document.getElementById('zone-name').value.trim(), capacity=Number(document.getElementById('zone-capacity').value); if(!name||!capacity) return alert('Укажите название зоны и вместимость.'); const i=zones.length; zones.push({name,capacity,x:80+(i%3)*280,y:80+Math.floor(i/3)*180,w:220,h:130}); render(); };
  }
}

function bindObjectDrag(floor, objects) {
  document.querySelectorAll('[data-object-id]').forEach(el => {
    el.onpointerdown = e => { if (e.target.closest('button')) return; if (tool === 'eraser') { objects.splice(Number(el.dataset.objectId),1); render(); return; } if (tool !== 'select') return; const i=Number(el.dataset.objectId), p=point(e,floor), o=objects[i], resize=e.target.closest('.resize-handle'); pointerAction={mode:resize?'resize':'move',index:i,dx:p.x-o.x,dy:p.y-o.y,startW:o.w,startH:o.h,startX:p.x,startY:p.y}; el.setPointerCapture(e.pointerId); };
    el.onpointermove = e => { if(!pointerAction || pointerAction.index!==Number(el.dataset.objectId)) return; const p=point(e,floor),o=objects[pointerAction.index]; if(pointerAction.mode==='move'){o.x=Math.max(0,Math.min(VIEWPORT_W-o.w,p.x-pointerAction.dx));o.y=Math.max(0,Math.min(VIEWPORT_H-o.h,p.y-pointerAction.dy));} else {o.w=Math.max(30,Math.min(VIEWPORT_W-o.x,pointerAction.startW+(p.x-pointerAction.startX)));o.h=Math.max(25,Math.min(VIEWPORT_H-o.y,pointerAction.startH+(p.y-pointerAction.startY)));} render(); };
    el.onpointerup = () => pointerAction=null;
  });
}

function shell() {
  root.innerHTML = `<div class="app"><aside class="side"><div class="brand"><div class="mark">B</div><div><div class="name">B-FBS</div><div class="sub">Складская система</div></div></div><nav class="nav" id="nav"></nav><div class="foot">● Система готова</div></aside><main class="main"><header class="top"><div><div class="eyebrow">B-FBS / РАБОЧАЯ СРЕДА</div><div class="title" id="title"></div></div><div class="user"><span class="avatar">A</span><span>Admin1</span><button id="api" class="btn">API Интеграция</button><button id="logout" class="btn">Выйти</button></div></header><section class="content" id="content"></section></main></div>`;
  TABS.forEach(([id,label],i)=>{const b=document.createElement('button');b.className=`nav-item ${activeTab===id?'active':''}`;b.innerHTML=`<span class="num">${String(i+1).padStart(2,'0')}</span><span>${label}</span>`;b.onclick=()=>{activeTab=id;render()};nav.appendChild(b)});
  title.textContent=TABS.find(x=>x[0]===activeTab)[1];
  logout.onclick=()=>{sessionStorage.removeItem(AUTH_KEY);render()};
  api.onclick=()=>alert('API Интеграция: подключение ключа WB и онлайн-синхронизация будут добавлены отдельным этапом.');
  content.innerHTML=activeTab==='dashboard'?dashboardView():activeTab==='workspace'?workspaceView():`<div class="empty-state panel"><div class="empty-icon">${String(TABS.findIndex(x=>x[0]===activeTab)+1).padStart(2,'0')}</div><h2>${TABS.find(x=>x[0]===activeTab)[1]}</h2><p>Раздел подготовлен. Функциональность будет добавляться поэтапно.</p></div>`;
  if(activeTab==='workspace') bindWorkspace();
}
function render(){ if(sessionStorage.getItem(AUTH_KEY)!=='admin') loginView(); else shell(); }
render();
