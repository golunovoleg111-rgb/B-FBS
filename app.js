const AUTH_KEY = 'b-fbs-auth';
const ADMIN_LOGIN = 'Admin1';
const ADMIN_PASSWORD = 'Admin123';
const TABS = [
  ['dashboard', 'Главный экран'], ['workspace', 'Рабочее пространство'], ['inventory', 'Учет склада'],
  ['transfer', 'Заявка на перемещение'], ['revision', 'Ревизия'], ['account', 'Личный кабинет'], ['tasks', 'Сборочное задание']
];
const VIEWPORT_W = 1000, VIEWPORT_H = 500;
const WORLD_W = 4000, WORLD_H = 2000;
const MIN_ZOOM = 0.25, MAX_ZOOM = 3;
const OBJECT_TYPES = {
  'Вход': { cls: 'entrance', icon: '↔', hint: 'Вход' },
  'Рабочая зона сборщиков': { cls: 'work', icon: '▦', hint: 'Рабочая зона' },
  'Место для коробок': { cls: 'boxes', icon: '▤', hint: 'Коробки' },
  'Место для мусора': { cls: 'trash', icon: '♻', hint: 'Мусор' },
  'Окно': { cls: 'window', icon: '▥', hint: 'Окно' },
  'Ворота': { cls: 'gate', icon: '⇆', hint: 'Ворота' },
  'Перегородка': { cls: 'partition', icon: '│', hint: 'Перегородка' }
};
const root = document.getElementById('root');
let activeTab = 'dashboard';
let workspaceMode = 'design'; // design | objects | management
let tool = 'select';
let pointerAction = null;
let draft = { walls: [], objects: [] };
let published = null;
let zones = [];
let view = { zoom: 1, panX: 0, panY: 0 };
let selectedObjectType = null;

function loginView() {
  root.innerHTML = `<main class="login"><section class="card"><div class="login-mark">B</div><div class="eyebrow">B-FBS</div><h1>Вход в систему</h1><p class="desc">Складская рабочая система</p><form class="form" id="login-form"><label>Логин<input id="login" autocomplete="username" required></label><label>Пароль<input id="password" type="password" autocomplete="current-password" required></label><div id="login-error"></div><button class="btn primary" type="submit">Войти</button></form></section></main>`;
  document.getElementById('login-form').onsubmit = e => {
    e.preventDefault();
    const login = document.getElementById('login').value;
    const password = document.getElementById('password').value;
    if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, 'admin');
      render();
    } else document.getElementById('login-error').innerHTML = '<div class="error">Неверный логин или пароль</div>';
  };
}

function dashboardView() {
  return `<div class="dashboard"><div class="welcome"><div><h2>Оперативная сводка</h2><p>Ключевые показатели склада за текущий момент.</p></div><div class="date">WB API: не подключен</div></div><div class="metrics"><div class="metric"><div class="metric-label">Заказы</div><div class="metric-value">0</div><div class="metric-note">Актуальные заказы на WB</div></div><div class="metric"><div class="metric-label">Готовые задания</div><div class="metric-value">0</div><div class="metric-note">Ожидают сборки</div></div><div class="metric"><div class="metric-label">Завершенные</div><div class="metric-value">0</div><div class="metric-note">Отгружены и закрыты</div></div><div class="metric"><div class="metric-label">Остатки</div><div class="metric-value">0</div><div class="metric-note">Единиц товара на складе</div></div></div><div class="panels"><div class="panel"><div class="panel-head"><div class="panel-title">Состояние сборки</div><div class="panel-link">Сегодня</div></div><div class="status-list"><div class="status-row"><span>В очереди</span><b>0</b></div><div class="status-row"><span>В работе</span><b>0</b></div><div class="status-row"><span>Готово к отгрузке</span><b>0</b></div></div></div><div class="panel"><div class="panel-head"><div class="panel-title">Последние события</div></div><div class="empty-panel">Событий пока нет</div></div></div></div>`;
}

function workspaceView() {
  const source = workspaceMode === 'management' && published ? published : draft;
  const design = workspaceMode === 'design';
  const objectStage = workspaceMode === 'objects';
  const visibleW = VIEWPORT_W / view.zoom, visibleH = VIEWPORT_H / view.zoom;
  return `<div class="workspace">
    <div class="workspace-head"><div><h2>${design ? 'Проектирование пространства' : objectStage ? 'Размещение элементов' : 'Склад'}</h2><p>${design ? 'Шаг 1 из 2 · создайте границы склада. После перехода стены становятся неизменяемыми.' : objectStage ? 'Шаг 2 из 2 · добавьте дополнительные элементы внутрь готового каркаса.' : 'Опубликованная схема склада.'}</p></div><div class="design-actions"><span class="${workspaceMode === 'management' ? 'saved-badge' : 'draft-badge'}">${workspaceMode === 'management' ? 'Опубликованная схема' : 'Черновик'}</span></div></div>
    <div class="workspace-grid"><aside class="tool-panel panel">${design ? designPanel() : objectStage ? objectPanel() : managementPanel()}</aside>
      <div class="canvas-wrap panel"><div class="canvas-toolbar"><div class="canvas-title">План склада · ${design ? 'проектирование пространства' : objectStage ? 'размещение элементов' : 'рабочая схема'}</div><div class="zoom-controls"><button id="zoom-out">−</button><span id="zoom-value">${Math.round(view.zoom * 100)}%</span><button id="zoom-in">+</button><button id="zoom-reset">100%</button><button id="zoom-fit">Вписать</button></div></div>
        <div class="floor ${design ? 'floor-design' : 'floor-objects'}" id="floor"><svg class="warehouse-svg" id="warehouse-svg" viewBox="${view.panX} ${view.panY} ${visibleW} ${visibleH}" preserveAspectRatio="none">${renderGrid()}${renderWalls(source.walls)}${renderDrawingPreview()}</svg><div class="world-objects" id="world-objects">${renderObjects(source.objects)}${renderZones(visibleW, visibleH)}</div>${!source.walls.length ? '<div class="floor-note">Выберите «Линия» или «Прямоугольник»<br><small>и нарисуйте границы склада</small></div>' : ''}</div><div class="canvas-help">Колесо — масштаб · ЛКМ по пустому месту — перемещение · Средняя кнопка — перемещение · Shift + ЛКМ — перемещение</div></div>
    </div></div>`;
}

function designPanel() {
  return `<div class="stage-indicator"><span class="stage-number">01</span><div><b>Стены</b><small>Проектирование пространства</small></div></div><p class="hint">Нарисуйте каркас склада. Стены можно создавать и удалять, пока вы находитесь на этом этапе.</p><div class="tool-buttons"><button class="tool ${tool === 'select' ? 'active' : ''}" data-tool="select">Выбор</button><button class="tool ${tool === 'line' ? 'active' : ''}" data-tool="line">Линия</button><button class="tool ${tool === 'rectangle' ? 'active' : ''}" data-tool="rectangle">Прямоугольник</button><button class="tool ${tool === 'eraser' ? 'active' : ''}" data-tool="eraser">Ластик</button></div><div class="legend"><span>Линия — отдельная стена</span><span>Прямоугольник — замкнутый контур</span><span>Ластик — удалить стену</span><span>ЛКМ по пустому месту — панорамирование в режиме выбора</span></div><button class="btn primary wide" id="to-objects" ${draft.walls.length ? '' : 'disabled'}>Перейти к объектам →</button>`;
}

function objectPanel() {
  return `<div class="stage-indicator"><span class="stage-number">02</span><div><b>Дополнительные объекты</b><small>Размещение внутри стен</small></div></div><p class="hint">Выберите элемент, затем зажмите ЛКМ и нарисуйте его размер на плане. Объекты нельзя вывести за границы каркаса.</p><div class="object-buttons">${Object.keys(OBJECT_TYPES).map(name => `<button class="object-btn ${selectedObjectType === name ? 'active' : ''}" data-object-tool="${name}"><span class="object-icon ${OBJECT_TYPES[name].cls}">${OBJECT_TYPES[name].icon}</span><span>${name}</span></button>`).join('')}</div><div class="object-mode-note">${selectedObjectType ? `Инструмент выбран: <b>${selectedObjectType}</b><br><small>Зажмите ЛКМ на плане и протяните до нужного размера.</small>` : 'Сначала выберите тип объекта.'}</div><div class="step-actions"><button class="btn" id="back-to-walls">← Вернуться к стенам</button><button class="btn primary wide" id="save-design">Сохранить изменения</button></div>`;
}

function managementPanel() {
  return `<div class="panel-title">Управление складом</div><p class="hint">Проектирование завершено. Сотрудники видят опубликованную схему. Изменение создаёт отдельную копию.</p><button class="btn wide" id="edit-copy">Создать копию для редактирования</button><div class="object-section"><div class="panel-title">Зоны хранения</div><p class="hint">Зоны добавляются после публикации схемы.</p><div class="zone-form"><label>Название зоны<input id="zone-name" placeholder="Например, Зона A"></label><label>Вместимость ящиков<input id="zone-capacity" type="number" min="1" placeholder="100"></label><button class="btn primary wide" id="add-zone">Добавить зону</button></div></div>`;
}

function renderGrid() {
  const step = 50, maxX = Math.min(WORLD_W, view.panX + VIEWPORT_W / view.zoom), maxY = Math.min(WORLD_H, view.panY + VIEWPORT_H / view.zoom);
  let h = '', sx = Math.floor(view.panX / step) * step, sy = Math.floor(view.panY / step) * step;
  for (let x = sx; x <= maxX; x += step) h += `<line class="grid-line" x1="${x}" y1="${view.panY}" x2="${x}" y2="${maxY}"/>`;
  for (let y = sy; y <= maxY; y += step) h += `<line class="grid-line" x1="${view.panX}" y1="${y}" x2="${maxX}" y2="${y}"/>`;
  return h;
}

function renderWalls(walls) {
  return walls.map((w, i) => w.type === 'line' ? `<line class="wall wall-line" data-wall-id="${i}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"/>` : `<rect class="wall wall-rect" data-wall-id="${i}" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}"/>`).join('');
}

function renderDrawingPreview() {
  if (!pointerAction || !['line', 'rectangle', 'object'].includes(pointerAction.mode)) return '';
  const s = pointerAction.start, p = pointerAction.current || s;
  if (pointerAction.mode === 'line') return `<line class="draw-preview line-preview" x1="${s.x}" y1="${s.y}" x2="${p.x}" y2="${p.y}"/>`;
  const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y), w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
  if (pointerAction.mode === 'object') {
    const type = OBJECT_TYPES[pointerAction.objectType];
    return `<rect class="draw-preview object-preview ${type ? type.cls : ''}" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="size-preview" x="${x + w / 2}" y="${Math.max(16, y - 8)}">${formatSize(w)} × ${formatSize(h)}</text>`;
  }
  return `<rect class="draw-preview rect-preview" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="size-preview" x="${x + w / 2}" y="${Math.max(16, y - 8)}">${formatSize(w)} × ${formatSize(h)}</text>`;
}

function formatSize(value) { return `${Math.round(value)} ед.`; }

function renderObjects(objects) {
  const vw = VIEWPORT_W / view.zoom, vh = VIEWPORT_H / view.zoom;
  return objects.map((o, i) => {
    const type = OBJECT_TYPES[o.name] || OBJECT_TYPES['Перегородка'];
    return `<div class="placed-object ${type.cls}" data-object-id="${i}" style="left:${(o.x - view.panX) / vw * 100}%;top:${(o.y - view.panY) / vh * 100}%;width:${o.w / vw * 100}%;height:${o.h / vh * 100}%"><span class="object-symbol">${type.icon}</span><span>${o.name}</span><button class="remove-object" data-remove="${i}" aria-label="Удалить">×</button><i class="resize-handle"></i></div>`;
  }).join('');
}

function renderZones(vw, vh) {
  return zones.map((z, i) => `<div class="zone" data-zone="${i}" style="left:${(z.x - view.panX) / vw * 100}%;top:${(z.y - view.panY) / vh * 100}%;width:${z.w / vw * 100}%;height:${z.h / vh * 100}%"><b>${z.name}</b><small>${z.capacity} ящиков</small><button>Открыть</button></div>`).join('');
}

function point(e, el) {
  const r = el.getBoundingClientRect(), vw = VIEWPORT_W / view.zoom, vh = VIEWPORT_H / view.zoom;
  return { x: view.panX + (e.clientX - r.left) / r.width * vw, y: view.panY + (e.clientY - r.top) / r.height * vh };
}

function clampPan() {
  const vw = VIEWPORT_W / view.zoom, vh = VIEWPORT_H / view.zoom;
  view.panX = Math.max(0, Math.min(Math.max(0, WORLD_W - vw), view.panX));
  view.panY = Math.max(0, Math.min(Math.max(0, WORLD_H - vh), view.panY));
}

function warehouseBounds() {
  const source = draft, items = [];
  source.walls.forEach(w => items.push(w.type === 'line' ? { x: Math.min(w.x1, w.x2), y: Math.min(w.y1, w.y2), w: Math.abs(w.x2 - w.x1), h: Math.abs(w.y2 - w.y1) } : w));
  if (!items.length) return null;
  const x = Math.max(0, Math.min(...items.map(a => a.x))), y = Math.max(0, Math.min(...items.map(a => a.y)));
  const right = Math.min(WORLD_W, Math.max(...items.map(a => a.x + a.w))), bottom = Math.min(WORLD_H, Math.max(...items.map(a => a.y + a.h)));
  return { x, y, w: Math.max(100, right - x), h: Math.max(100, bottom - y) };
}

function fitView() {
  const b = warehouseBounds();
  if (!b) { view = { zoom: 1, panX: 0, panY: 0 }; return; }
  view.zoom = Math.max(MIN_ZOOM, Math.min(1, Math.min(VIEWPORT_W / b.w, VIEWPORT_H / b.h)));
  view.panX = Math.max(0, b.x - (VIEWPORT_W / view.zoom - b.w) / 2);
  view.panY = Math.max(0, b.y - (VIEWPORT_H / view.zoom - b.h) / 2);
  clampPan();
}

function setZoom(next, focus = null) {
  const old = view.zoom, el = document.getElementById('floor');
  view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
  if (focus && el) {
    const r = el.getBoundingClientRect(), fx = (focus.clientX - r.left) / r.width, fy = (focus.clientY - r.top) / r.height;
    view.panX += fx * (VIEWPORT_W / old - VIEWPORT_W / view.zoom);
    view.panY += fy * (VIEWPORT_H / old - VIEWPORT_H / view.zoom);
  }
  clampPan(); render();
}

function objectInsideWarehouse(o) {
  const b = warehouseBounds();
  return !!b && o.x >= b.x && o.y >= b.y && o.x + o.w <= b.x + b.w && o.y + o.h <= b.y + b.h;
}

function updateCanvasView() {
  const svg = document.getElementById('warehouse-svg'), floor = document.getElementById('floor'), objects = document.getElementById('world-objects');
  if (!floor || !svg) return;
  const vw = VIEWPORT_W / view.zoom, vh = VIEWPORT_H / view.zoom;
  svg.setAttribute('viewBox', `${view.panX} ${view.panY} ${vw} ${vh}`);
  document.getElementById('zoom-value').textContent = `${Math.round(view.zoom * 100)}%`;
  objects.innerHTML = renderObjects(workspaceMode === 'design' || workspaceMode === 'objects' ? draft.objects : (published || draft).objects) + renderZones(vw, vh);
  bindObjectDrag(floor, workspaceMode === 'objects' ? draft.objects : (published || draft).objects);
}

function bindWorkspace() {
  const floor = document.getElementById('floor');
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { tool = b.dataset.tool; render(); });
  document.querySelectorAll('[data-object-tool]').forEach(b => b.onclick = () => { selectedObjectType = b.dataset.objectTool; tool = 'object'; render(); });
  document.getElementById('zoom-out').onclick = () => setZoom(view.zoom - .25);
  document.getElementById('zoom-in').onclick = () => setZoom(view.zoom + .25);
  document.getElementById('zoom-reset').onclick = () => { view = { zoom: 1, panX: 0, panY: 0 }; render(); };
  document.getElementById('zoom-fit').onclick = () => { fitView(); render(); };
  floor.onwheel = e => { e.preventDefault(); setZoom(view.zoom + (e.deltaY < 0 ? .25 : -.25), e); };

  floor.onpointerdown = e => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey) || (e.button === 0 && tool === 'select' && !e.target.closest('.placed-object'))) {
      pointerAction = { mode: 'pan', startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY };
      floor.setPointerCapture(e.pointerId); floor.classList.add('panning'); return;
    }
    if (e.button !== 0) return;
    if (workspaceMode === 'design' && tool === 'eraser') return;
    if (workspaceMode === 'design' && ['line', 'rectangle'].includes(tool)) {
      const p = point(e, floor); pointerAction = { mode: tool, start: p, current: p }; floor.setPointerCapture(e.pointerId); updatePreview(); return;
    }
    if (workspaceMode === 'objects' && tool === 'object' && selectedObjectType) {
      const p = point(e, floor); pointerAction = { mode: 'object', objectType: selectedObjectType, start: p, current: p }; floor.setPointerCapture(e.pointerId); updatePreview();
    }
  };

  floor.onpointermove = e => {
    if (!pointerAction) return;
    if (pointerAction.mode === 'pan') {
      const vw = VIEWPORT_W / view.zoom, vh = VIEWPORT_H / view.zoom;
      view.panX = pointerAction.panX - (e.clientX - pointerAction.startX) / floor.clientWidth * vw;
      view.panY = pointerAction.panY - (e.clientY - pointerAction.startY) / floor.clientHeight * vh;
      clampPan(); updateCanvasView(); return;
    }
    pointerAction.current = point(e, floor); updatePreview();
  };

  floor.onpointerup = e => {
    if (!pointerAction) return;
    if (pointerAction.mode === 'pan') { pointerAction = null; floor.classList.remove('panning'); return; }
    const action = pointerAction, p = point(e, floor), s = action.start;
    const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y), w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
    if (workspaceMode === 'design') {
      if (action.mode === 'line' && w + h > 5) draft.walls.push({ type: 'line', x1: s.x, y1: s.y, x2: p.x, y2: p.y });
      if (action.mode === 'rectangle' && w > 10 && h > 10) draft.walls.push({ type: 'rect', x, y, w, h });
    }
    if (workspaceMode === 'objects' && action.mode === 'object' && w > 10 && h > 10) {
      const candidate = { name: action.objectType, x, y, w, h };
      if (objectInsideWarehouse(candidate)) draft.objects.push(candidate); else alert('Объект нельзя разместить за пределами стен склада.');
    }
    pointerAction = null; render();
  };

  floor.onpointercancel = () => { pointerAction = null; floor.classList.remove('panning'); render(); };

  document.querySelectorAll('.wall').forEach(el => el.onclick = e => {
    if (workspaceMode === 'design' && tool === 'eraser') { e.stopPropagation(); draft.walls.splice(Number(el.dataset.wallId), 1); render(); }
  });

  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = e => {
    e.stopPropagation(); draft.objects.splice(Number(b.dataset.remove), 1); render();
  });

  bindObjectDrag(floor, workspaceMode === 'objects' ? draft.objects : (published || draft).objects);

  const toObjects = document.getElementById('to-objects');
  if (toObjects) toObjects.onclick = () => { workspaceMode = 'objects'; tool = 'select'; selectedObjectType = null; render(); };
  const back = document.getElementById('back-to-walls');
  if (back) back.onclick = () => { workspaceMode = 'design'; tool = 'select'; render(); };
  const save = document.getElementById('save-design');
  if (save) save.onclick = () => { published = JSON.parse(JSON.stringify(draft)); workspaceMode = 'management'; view = { zoom: 1, panX: 0, panY: 0 }; render(); };
  const edit = document.getElementById('edit-copy');
  if (edit) edit.onclick = () => { draft = JSON.parse(JSON.stringify(published || draft)); workspaceMode = 'design'; tool = 'select'; selectedObjectType = null; view = { zoom: 1, panX: 0, panY: 0 }; render(); };
  const addZone = document.getElementById('add-zone');
  if (addZone) addZone.onclick = () => {
    const name = document.getElementById('zone-name').value.trim(), capacity = Number(document.getElementById('zone-capacity').value);
    if (!name || !capacity) return alert('Укажите название зоны и вместимость.');
    const i = zones.length; zones.push({ name, capacity, x: 80 + (i % 3) * 280, y: 80 + Math.floor(i / 3) * 180, w: 220, h: 130 }); render();
  };
}

function updatePreview() {
  const svg = document.getElementById('warehouse-svg');
  if (!svg) return;
  const old = svg.querySelector('.preview-group');
  if (old) old.remove();
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'preview-group');
  group.innerHTML = renderDrawingPreview();
  svg.appendChild(group);
}

function bindObjectDrag(floor, objects) {
  document.querySelectorAll('[data-object-id]').forEach(el => {
    el.onpointerdown = e => {
      if (workspaceMode === 'objects' && tool === 'eraser') { objects.splice(Number(el.dataset.objectId), 1); render(); return; }
      if (workspaceMode !== 'management' || tool !== 'select') return;
      if (e.target.closest('button')) return;
      const i = Number(el.dataset.objectId), p = point(e, floor), o = objects[i], resize = e.target.closest('.resize-handle');
      pointerAction = { mode: resize ? 'resize' : 'move', index: i, dx: p.x - o.x, dy: p.y - o.y, startW: o.w, startH: o.h, startX: p.x, startY: p.y };
      el.setPointerCapture(e.pointerId);
    };
    el.onpointermove = e => {
      if (!pointerAction || pointerAction.index !== Number(el.dataset.objectId)) return;
      const p = point(e, floor), o = objects[pointerAction.index];
      if (pointerAction.mode === 'move') {
        o.x = Math.max(0, Math.min(WORLD_W - o.w, p.x - pointerAction.dx));
        o.y = Math.max(0, Math.min(WORLD_H - o.h, p.y - pointerAction.dy));
      } else {
        o.w = Math.max(30, Math.min(WORLD_W - o.x, pointerAction.startW + (p.x - pointerAction.startX)));
        o.h = Math.max(25, Math.min(WORLD_H - o.y, pointerAction.startH + (p.y - pointerAction.startY)));
      }
      el.style.left = (o.x - view.panX) / (VIEWPORT_W / view.zoom) * 100 + '%';
      el.style.top = (o.y - view.panY) / (VIEWPORT_H / view.zoom) * 100 + '%';
      el.style.width = o.w / (VIEWPORT_W / view.zoom) * 100 + '%';
      el.style.height = o.h / (VIEWPORT_H / view.zoom) * 100 + '%';
    };
    el.onpointerup = () => pointerAction = null;
  });
}

function shell() {
  root.innerHTML = `<div class="app"><aside class="side"><div class="brand"><div class="mark">B</div><div><div class="name">B-FBS</div><div class="sub">Складская система</div></div></div><nav class="nav" id="nav"></nav><div class="foot">● Система готова</div></aside><main class="main"><header class="top"><div><div class="eyebrow">B-FBS / РАБОЧАЯ СРЕДА</div><div class="title" id="title"></div></div><div class="user"><span class="avatar">A</span><span>Admin1</span><button id="api" class="btn">API Интеграция</button><button id="logout" class="btn">Выйти</button></div></header><section class="content" id="content"></section></main></div>`;
  TABS.forEach(([id, label], i) => { const b = document.createElement('button'); b.className = `nav-item ${activeTab === id ? 'active' : ''}`; b.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span>${label}</span>`; b.onclick = () => { activeTab = id; render(); }; nav.appendChild(b); });
  title.textContent = TABS.find(x => x[0] === activeTab)[1];
  logout.onclick = () => { sessionStorage.removeItem(AUTH_KEY); render(); };
  api.onclick = () => alert('API Интеграция: подключение ключа WB и онлайн-синхронизация будут добавлены отдельным этапом.');
  content.innerHTML = activeTab === 'dashboard' ? dashboardView() : activeTab === 'workspace' ? workspaceView() : `<div class="empty-state panel"><div class="empty-icon">${String(TABS.findIndex(x => x[0] === activeTab) + 1).padStart(2, '0')}</div><h2>${TABS.find(x => x[0] === activeTab)[1]}</h2><p>Раздел подготовлен. Функциональность будет добавляться поэтапно.</p></div>`;
  if (activeTab === 'workspace') bindWorkspace();
}

function render() { if (sessionStorage.getItem(AUTH_KEY) !== 'admin') loginView(); else shell(); }
render();
