const AUTH_KEY = 'b-fbs-auth';
const ADMIN_LOGIN = 'Admin1';
const ADMIN_PASSWORD = 'Admin123';

const TABS = [
  ['dashboard', 'Главный экран'],
  ['workspace', 'Рабочее пространство'],
  ['inventory', 'Учет склада'],
  ['transfer', 'Заявка на перемещение'],
  ['revision', 'Ревизия'],
  ['account', 'Личный кабинет'],
  ['tasks', 'Сборочное задание'],
];

const root = document.getElementById('root');
let activeTab = 'dashboard';
let workspaceStep = 1;
let workspaceObjects = [];
let workspaceZones = [];

function loginView() {
  root.innerHTML = `<main class="login"><section class="card"><div class="login-mark">B</div><div class="eyebrow">B-FBS</div><h1>Вход в систему</h1><p class="desc">Складская рабочая система</p><form class="form" id="login-form"><label>Логин<input id="login" autocomplete="username" required></label><label>Пароль<input id="password" type="password" autocomplete="current-password" required></label><div id="login-error"></div><button class="btn primary" type="submit">Войти</button></form></section></main>`;
  document.getElementById('login-form').onsubmit = (event) => {
    event.preventDefault();
    if (document.getElementById('login').value === ADMIN_LOGIN && document.getElementById('password').value === ADMIN_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, 'admin');
      render();
    } else {
      document.getElementById('login-error').innerHTML = '<div class="error">Неверный логин или пароль</div>';
    }
  };
}

function dashboardView() {
  return `<div class="dashboard"><div class="welcome"><div><h2>Оперативная сводка</h2><p>Ключевые показатели склада за текущий момент.</p></div><div class="date">WB API: не подключен</div></div><div class="metrics"><div class="metric"><div class="metric-label">Заказы</div><div class="metric-value">0</div><div class="metric-note">Актуальные заказы на WB</div></div><div class="metric"><div class="metric-label">Готовые задания</div><div class="metric-value">0</div><div class="metric-note">Ожидают сборки</div></div><div class="metric"><div class="metric-label">Завершенные</div><div class="metric-value">0</div><div class="metric-note">Отгружены и закрыты</div></div><div class="metric"><div class="metric-label">Остатки</div><div class="metric-value">0</div><div class="metric-note">Единиц товара на складе</div></div></div><div class="panels"><div class="panel"><div class="panel-head"><div class="panel-title">Состояние сборки</div><div class="panel-link">Сегодня</div></div><div class="status-list"><div class="status-row"><span>В очереди</span><b>0</b></div><div class="status-row"><span>В работе</span><b>0</b></div><div class="status-row"><span>Готово к отгрузке</span><b>0</b></div></div></div><div class="panel"><div class="panel-head"><div class="panel-title">Последние события</div></div><div class="empty-panel">Событий пока нет</div></div></div></div>`;
}

function workspaceView() {
  return `<div class="workspace"><div class="workspace-head"><div><h2>Конструктор склада</h2><p>Создайте план склада по этапам. На этом этапе данные сохраняются только в текущем сеансе.</p></div><div class="stepper"><button class="step ${workspaceStep === 1 ? 'active' : ''}" data-step="1">01 Стены</button><span>→</span><button class="step ${workspaceStep === 2 ? 'active' : ''}" data-step="2">02 Объекты</button><span>→</span><button class="step ${workspaceStep === 3 ? 'active' : ''}" data-step="3">03 Зоны</button></div></div>${workspaceStep === 1 ? wallsStep() : workspaceStep === 2 ? objectsStep() : zonesStep()}</div>`;
}

function wallsStep() {
  return `<div class="workspace-grid"><aside class="tool-panel panel"><div class="panel-title">Шаг №1. Укажите стены</div><p class="hint">Выберите инструмент и задайте границы склада на рабочем поле.</p><div class="tool-buttons"><button class="tool active" data-tool="select">Выбор</button><button class="tool" data-tool="line">Линия</button><button class="tool" data-tool="rectangle">Прямоугольник</button></div><div class="legend"><span>Линия — отдельная стена</span><span>Прямоугольник — быстрый каркас</span></div><button class="btn primary wide" id="to-objects">Перейти к объектам</button></aside><div class="canvas-wrap panel"><div class="canvas-title">План склада</div><div class="floor" id="floor"><div class="floor-note">Рабочая область<br><small>Выберите «Линия» или «Прямоугольник»</small></div></div></div></div>`;
}

function objectsStep() {
  const required = ['Вход', 'Рабочая зона сборщиков', 'Место для коробок', 'Место для мусора'];
  const optional = ['Окно', 'Ворота', 'Перегородка'];
  return `<div class="workspace-grid"><aside class="tool-panel panel"><div class="panel-title">Шаг №2. Дополнительные объекты</div><p class="hint">Обязательные элементы должны присутствовать на плане до создания зон.</p><h3>Обязательные</h3><div class="object-buttons">${required.map(x => `<button class="object-btn" data-object="${x}">${x}</button>`).join('')}</div><h3>Необязательные</h3><div class="object-buttons">${optional.map(x => `<button class="object-btn" data-object="${x}">${x}</button>`).join('')}</div><button class="btn primary wide" id="finish-layout">Готово — создать склад</button></aside><div class="canvas-wrap panel"><div class="canvas-title">План склада</div><div class="floor" id="floor"><div class="floor-note">Разместите объекты на плане</div>${workspaceObjects.map((x,i) => `<button class="placed-object" style="left:${12 + (i%4)*20}%;top:${18 + Math.floor(i/4)*22}%" data-remove-object="${i}">${x}</button>`).join('')}</div></div></div>`;
}

function zonesStep() {
  return `<div class="workspace-grid"><aside class="tool-panel panel"><div class="panel-title">Склад создан</div><p class="hint">Теперь добавьте зоны для размещения ячеек хранения.</p><div class="zone-form"><label>Название зоны<input id="zone-name" placeholder="Например, Зона A"></label><label>Вместимость ящиков<input id="zone-capacity" type="number" min="1" placeholder="100"></label><button class="btn primary wide" id="add-zone">Добавить зону</button></div><div class="legend"><span>Зоны не должны пересекаться.</span><span>Редактирование после создания будет ограничено.</span></div></aside><div class="canvas-wrap panel"><div class="canvas-title">План склада · зоны</div><div class="floor zones-floor" id="floor">${workspaceZones.length ? workspaceZones.map((z,i) => `<div class="zone" style="left:${z.x}%;top:${z.y}%;width:${z.w}%;height:${z.h}%"><b>${z.name}</b><small>${z.capacity} ящиков</small><button data-zone="${i}">Открыть</button></div>`).join('') : '<div class="floor-note">Зон пока нет</div>'}</div></div></div>`;
}

function shell() {
  root.innerHTML = `<div class="app"><aside class="side"><div class="brand"><div class="mark">B</div><div><div class="name">B-FBS</div><div class="sub">Складская система</div></div></div><nav class="nav" id="nav"></nav><div class="foot">● Система готова</div></aside><main class="main"><header class="top"><div><div class="eyebrow">B-FBS / РАБОЧАЯ СРЕДА</div><div class="title" id="title"></div></div><div class="user"><span class="avatar">A</span><span>Admin1</span><button id="api" class="btn">API Интеграция</button><button id="logout" class="btn">Выйти</button></div></header><section class="content" id="content"></section></main></div>`;
  const nav = document.getElementById('nav');
  TABS.forEach(([id, label], index) => {
    const button = document.createElement('button');
    button.className = `nav-item ${activeTab === id ? 'active' : ''}`;
    button.innerHTML = `<span class="num">${String(index + 1).padStart(2, '0')}</span><span>${label}</span>`;
    button.onclick = () => { activeTab = id; render(); };
    nav.appendChild(button);
  });
  document.getElementById('title').textContent = TABS.find(([id]) => id === activeTab)[1];
  document.getElementById('logout').onclick = () => { sessionStorage.removeItem(AUTH_KEY); render(); };
  document.getElementById('api').onclick = () => alert('Раздел API Интеграция будет расширен: подключение ключа WB, синхронизация заказов и сборочных заданий.');
  const content = document.getElementById('content');
  content.innerHTML = activeTab === 'dashboard' ? dashboardView() : activeTab === 'workspace' ? workspaceView() : `<div class="empty-state panel"><div class="empty-icon">${String(TABS.findIndex(([id]) => id === activeTab) + 1).padStart(2,'0')}</div><h2>${TABS.find(([id]) => id === activeTab)[1]}</h2><p>Раздел подготовлен. Функциональность будет добавляться поэтапно.</p></div>`;
  bindWorkspace();
}

function bindWorkspace() {
  if (activeTab !== 'workspace') return;
  document.querySelectorAll('[data-step]').forEach(btn => btn.onclick = () => { workspaceStep = Number(btn.dataset.step); render(); });
  const toObjects = document.getElementById('to-objects');
  if (toObjects) toObjects.onclick = () => { workspaceStep = 2; render(); };
  document.querySelectorAll('[data-object]').forEach(btn => btn.onclick = () => { if (!workspaceObjects.includes(btn.dataset.object)) workspaceObjects.push(btn.dataset.object); render(); });
  document.querySelectorAll('[data-remove-object]').forEach(btn => btn.onclick = () => { workspaceObjects.splice(Number(btn.dataset.removeObject),1); render(); });
  const finish = document.getElementById('finish-layout');
  if (finish) finish.onclick = () => { workspaceStep = 3; render(); };
  const addZone = document.getElementById('add-zone');
  if (addZone) addZone.onclick = () => {
    const name = document.getElementById('zone-name').value.trim();
    const capacity = Number(document.getElementById('zone-capacity').value);
    if (!name || !capacity) return alert('Укажите название зоны и вместимость.');
    const index = workspaceZones.length;
    const w = 22, h = 18, x = 5 + (index % 3) * 30, y = 8 + Math.floor(index / 3) * 25;
    workspaceZones.push({name, capacity, x, y, w, h});
    render();
  };
  document.querySelectorAll('[data-zone]').forEach(btn => btn.onclick = () => alert(`Зона: ${workspaceZones[Number(btn.dataset.zone)].name}\nЯщики: 0\nВместимость: ${workspaceZones[Number(btn.dataset.zone)].capacity}`));
}

function render() {
  if (sessionStorage.getItem(AUTH_KEY) !== 'admin') loginView(); else shell();
}

render();
