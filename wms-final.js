/* B-FBS Commercial WMS v1 — centralized sync and operational modules. */
(function(){
  'use strict';

  const WMS_KEY='b-fbs-wms-v1';
  const USER_KEY='b-fbs-user';
  const TOKEN_KEY='b-fbs-token';
  const REVISION_KEY='b-fbs-server-revision';
  const PENDING_KEY='b-fbs-sync-pending';
  const WAREHOUSE_KEY='b-fbs-warehouses-v1';
  const ACTIVE_WAREHOUSE_KEY='b-fbs-active-warehouse';
  const ROLE_NAMES={admin:'Администратор',manager:'Менеджер',picker:'Сборщик',auditor:'Ревизор'};
  const PERMISSION_LABELS={
    dashboard_view:['Главный экран','Просмотр оперативной сводки'],
    workspace_view:['Рабочее пространство','Просмотр схемы склада, зон и коробок'],
    layout_manage:['Планировка склада','Создание складов, изменение стен, объектов и публикация схемы'],
    zones_manage:['Зоны хранения','Создание, перемещение, изменение, заморозка и удаление зон'],
    inventory_view:['Учет склада','Просмотр номенклатуры, коробок и остатков'],
    inventory_manage:['Коробки и остатки','Создание/удаление коробок, ручное и массовое пополнение'],
    nomenclature_manage:['Номенклатура','Импорт и изменение номенклатуры WB'],
    transfers_view:['Перемещения','Просмотр заявок на перемещение'],
    transfers_manage:['Управление перемещениями','Создание, отправка, прием и отмена заявок'],
    revisions_view:['Ревизия','Просмотр заданий ревизии'],
    revisions_manage:['Проведение ревизии','Создание и выполнение ревизий'],
    tasks_view:['Сборочные задания','Просмотр сборочных заданий'],
    tasks_manage:['Управление заданиями','Создание и завершение сборочных заданий'],
    tasks_pick:['Сборка сканером','Scanner Mode и списание товара по заданию']
  };
  const ALL_PERMISSION_KEYS=Object.keys(PERMISSION_LABELS);
  const ROLE_PERMISSION_DEFAULTS={
    admin:Object.fromEntries(ALL_PERMISSION_KEYS.map(key=>[key,true])),
    manager:{dashboard_view:true,workspace_view:true,layout_manage:true,zones_manage:true,inventory_view:true,inventory_manage:true,nomenclature_manage:true,transfers_view:true,transfers_manage:true,revisions_view:true,revisions_manage:true,tasks_view:true,tasks_manage:true,tasks_pick:true},
    picker:{dashboard_view:true,workspace_view:true,layout_manage:false,zones_manage:false,inventory_view:true,inventory_manage:false,nomenclature_manage:false,transfers_view:true,transfers_manage:true,revisions_view:false,revisions_manage:false,tasks_view:true,tasks_manage:false,tasks_pick:true},
    auditor:{dashboard_view:true,workspace_view:true,layout_manage:false,zones_manage:false,inventory_view:true,inventory_manage:false,nomenclature_manage:false,transfers_view:false,transfers_manage:false,revisions_view:true,revisions_manage:true,tasks_view:false,tasks_manage:false,tasks_pick:false}
  };
  const TAB_PERMISSION={dashboard:'dashboard_view',workspace:'workspace_view',inventory:'inventory_view',transfer:'transfers_view',revision:'revisions_view',tasks:'tasks_view'};
  const EMPTY_WMS={nomenclature:[],boxes:[],transfers:[],revisions:[],tasks:[],movements:[],events:[]};
  let wms=loadWms();
  let currentUser=readJson(sessionStorage.getItem(USER_KEY),null);
  let backendAvailable=false,backendHealth=null;
  let serverRevision=Number(localStorage.getItem(REVISION_KEY)||0);
  let syncTimer=0,pollTimer=0,syncing=false,lastSyncError='';
  let zoneDraw=false,zoneStart=null,zoneCurrent=null;
  let zoneMoveId='',zoneMoveStart=null,zoneMoveChanged=false,zoneResizeStart=null,zoneEditOriginal=null,zoneEditDirty=false,zoneMenu=null,suppressZoneClickUntil=0;
  const GOOGLE_SUMMARY_SHEET_ID='1oaf7MiFLdMpOI-syYOaJEeXpIyGRLzkGkUXvlMbJroU';
  const GOOGLE_SUMMARY_GID='0';
  let sheetSummary=[],sheetSummaryError='',sheetSummaryLoading=false,sheetSummaryLoadedAt=0;

  function readJson(value,fallback){try{return value?JSON.parse(value):fallback}catch(_){return fallback}}
  function loadWms(){return Object.assign({},EMPTY_WMS,readJson(localStorage.getItem(WMS_KEY),{}))}
  function uid(prefix){return `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`.toUpperCase()}
  function dateText(value){return value?new Date(value).toLocaleString('ru-RU'):'—'}
  function roleName(role){return ROLE_NAMES[role]||role||'Сотрудник'}
  function defaultPermissions(role){return {...(ROLE_PERMISSION_DEFAULTS[role]||ROLE_PERMISSION_DEFAULTS.picker)}}
  function userPermissions(user=currentUser){return user?.role==='admin'?defaultPermissions('admin'):{...defaultPermissions(user?.role||'picker'),...(user?.permissions||{})}}
  function can(permission,user=currentUser){return user?.role==='admin'||!!userPermissions(user)[permission]}
  function allowed(tab){
    if(tab==='account')return currentUser?.role==='admin';
    const permission=TAB_PERMISSION[tab];return permission?can(permission):false;
  }
  function requireClientPermission(permission,message='Недостаточно прав для этой операции.'){
    if(can(permission))return true;toast(message,'warning');return false;
  }
  function warehouses(){return readJson(localStorage.getItem(WAREHOUSE_KEY),[])||[]}
  function activeWarehouseId(){
    const select=document.getElementById('warehouse-select');
    const id=select?.value||localStorage.getItem(ACTIVE_WAREHOUSE_KEY)||warehouses()[0]?.id||'';
    if(id)localStorage.setItem(ACTIVE_WAREHOUSE_KEY,id);return id;
  }
  function warehouseName(id){return warehouses().find(item=>item.id===id)?.name||draft?.name||'Склад'}
  function cloneValue(value){return JSON.parse(JSON.stringify(value))}
  function serializeState(){
    return {warehouses:readJson(localStorage.getItem(WAREHOUSE_KEY),null),workspace:readJson(localStorage.getItem('b-fbs-workspace'),null),wms:cloneValue(wms)};
  }
  function applyState(state){
    if(state?.warehouses)localStorage.setItem(WAREHOUSE_KEY,JSON.stringify(state.warehouses));
    if(state?.workspace)localStorage.setItem('b-fbs-workspace',JSON.stringify(state.workspace));
    if(state?.wms){wms=Object.assign({},EMPTY_WMS,state.wms);localStorage.setItem(WMS_KEY,JSON.stringify(wms))}
  }
  function mergeById(serverItems=[],localItems=[]){
    const result=new Map(serverItems.map(item=>[item.id,item]));localItems.forEach(item=>{const server=result.get(item.id),localTime=new Date(item.updatedAt||item.completedAt||item.readyAt||item.createdAt||0).getTime(),serverTime=new Date(server?.updatedAt||server?.completedAt||server?.readyAt||server?.createdAt||0).getTime();if(!server||localTime>=serverTime)result.set(item.id,item)});return [...result.values()];
  }
  function mergeConflictState(serverState,localState){
    const serverWms=Object.assign({},EMPTY_WMS,serverState?.wms||{}),localWms=Object.assign({},EMPTY_WMS,localState?.wms||{}),serverMovementIds=new Set(serverWms.movements.map(item=>item.id));
    const originalServerBoxIds=new Set(serverWms.boxes.map(box=>box.id)),serverBoxes=new Map(serverWms.boxes.map(box=>[box.id,cloneValue(box)]));localWms.boxes.forEach(localBox=>{if(!serverBoxes.has(localBox.id))serverBoxes.set(localBox.id,cloneValue(localBox))});
    localWms.movements.filter(move=>!serverMovementIds.has(move.id)&&originalServerBoxIds.has(move.boxId)).forEach(move=>{const box=serverBoxes.get(move.boxId);if(!box||!move.barcode)return;let item=(box.items||[]).find(row=>row.barcode===move.barcode);if(!item){item={article:move.article,barcode:move.barcode,size:move.size,quantity:0};box.items.push(item)}item.quantity=Math.max(0,Number(item.quantity||0)+Number(move.quantity||0));box.updatedAt=move.at});
    return {warehouses:localState.warehouses||serverState.warehouses,workspace:localState.workspace||serverState.workspace,wms:{nomenclature:mergeById(serverWms.nomenclature,localWms.nomenclature),boxes:[...serverBoxes.values()],transfers:mergeById(serverWms.transfers,localWms.transfers),revisions:mergeById(serverWms.revisions,localWms.revisions),tasks:mergeById(serverWms.tasks,localWms.tasks),movements:mergeById(serverWms.movements,localWms.movements).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,5000),events:mergeById(serverWms.events,localWms.events).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,200)}};
  }
  function saveWms(eventText){
    localStorage.setItem(WMS_KEY,JSON.stringify(wms));
    if(eventText){wms.events.unshift({id:uid('EVT'),text:eventText,at:new Date().toISOString(),user:currentUser?.name||'Локально'});wms.events=wms.events.slice(0,200);localStorage.setItem(WMS_KEY,JSON.stringify(wms))}
    scheduleSync();
  }
  function recordMovement(type,quantity,box,item,note=''){
    wms.movements.unshift({id:uid('MOV'),type,quantity:Number(quantity)||0,boxId:box?.id||'',warehouseId:box?.warehouseId||'',zoneId:box?.zoneId||'',barcode:item?.barcode||'',article:item?.article||'',size:item?.size||'',note,userId:currentUser?.id||'',userName:currentUser?.name||'',at:new Date().toISOString()});
    wms.movements=wms.movements.slice(0,5000);
  }
  function token(){return sessionStorage.getItem(TOKEN_KEY)||''}
  async function requestApi(pathname,options={}){
    const headers=Object.assign({'Content-Type':'application/json'},options.headers||{});
    if(token())headers.Authorization=`Bearer ${token()}`;
    const response=await fetch(`.${pathname}`,Object.assign({},options,{headers}));
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||`Ошибка ${response.status}`);error.status=response.status;error.data=data;throw error}
    return data;
  }
  async function detectBackend(){
    try{
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2500);
      const response=await fetch('./api/health',{cache:'no-store',signal:controller.signal});
      clearTimeout(timeout);
      backendAvailable=response.ok&&String(response.headers.get('content-type')||'').includes('json');
      backendHealth=backendAvailable?await response.json().catch(()=>null):null;
    }catch(_){backendAvailable=false;backendHealth=null}
    document.body.classList.toggle('backend-online',backendAvailable);
    return backendAvailable;
  }
  function scheduleSync(){
    localStorage.setItem(PENDING_KEY,'1');
    clearTimeout(syncTimer);syncTimer=setTimeout(pushState,350);
    updateConnectionBadge();
  }
  async function pushState(){
    if(syncing||!backendAvailable||!token())return;
    syncing=true;clearTimeout(syncTimer);syncTimer=0;
    try{
      const result=await requestApi('/api/state',{method:'PUT',body:JSON.stringify({revision:serverRevision,state:serializeState()})});
      serverRevision=result.revision;localStorage.setItem(REVISION_KEY,String(serverRevision));localStorage.removeItem(PENDING_KEY);lastSyncError='';
    }catch(error){
      lastSyncError=error.message;
      if(error.status===409){const localState=serializeState(),latest=await requestApi('/api/state');serverRevision=latest.revision;applyState(mergeConflictState(latest.state,localState));localStorage.setItem(REVISION_KEY,String(serverRevision));syncing=false;await pushState();toast('Одновременные изменения сотрудников объединены.','warning')}
    }finally{syncing=false;updateConnectionBadge()}
  }
  async function pullState(force=false){
    if(!backendAvailable||!token())return false;
    if(!force&&localStorage.getItem(PENDING_KEY)==='1')return false;
    const result=await requestApi('/api/state');
    if(result.revision===0&&!result.state?.warehouses&&warehouses().length){serverRevision=0;await pushState();return true}
    if(force||result.revision>serverRevision){
      applyState(result.state);serverRevision=result.revision;localStorage.setItem(REVISION_KEY,String(serverRevision));localStorage.removeItem(PENDING_KEY);
      return true;
    }
    return false;
  }
  async function pollState(){
    clearTimeout(pollTimer);
    if(!backendAvailable||!token()){pollTimer=setTimeout(pollState,4000);return}
    try{
      const changed=await pullState(false);
      if(changed){
        if(activeTab==='workspace')toast('Схема обновлена на сервере. Обновите страницу перед редактированием.','info');
        else window.render();
      }
    }catch(error){lastSyncError=error.message}
    updateConnectionBadge();pollTimer=setTimeout(pollState,2500);
  }
  function updateConnectionBadge(){
    const badge=document.getElementById('connection-badge');if(!badge)return;
    const pending=localStorage.getItem(PENDING_KEY)==='1';
    const ephemeral=backendAvailable&&backendHealth?.storage==='ephemeral';
    badge.className=`connection-badge ${backendAvailable?(ephemeral?'warning':(pending?'pending':'online')):'offline'}`;
    badge.textContent=backendAvailable?(ephemeral?'Онлайн · без диска':(pending?'Синхронизация…':'Онлайн')):'Автономно';
    badge.title=lastSyncError||(ephemeral?'Сервер работает, но база находится во временном хранилище. Подключите persistent volume перед рабочим использованием.':'');
  }
  function toast(message,type='info'){
    let host=document.getElementById('wms-toasts');if(!host){host=document.createElement('div');host.id='wms-toasts';document.body.appendChild(host)}
    const item=document.createElement('div');item.className=`wms-toast ${type}`;item.textContent=message;host.appendChild(item);setTimeout(()=>item.remove(),4200);
  }
  function openModal(title,body,onReady){
    const node=document.createElement('div');node.className='modal-backdrop';node.innerHTML=`<section class="modal wms-modal"><button class="modal-close" data-close>×</button><h2>${esc(title)}</h2>${body}</section>`;document.body.appendChild(node);
    const close=()=>node.remove();node.querySelectorAll('[data-close]').forEach(button=>button.onclick=close);node.addEventListener('click',event=>{if(event.target===node)close()});if(onReady)onReady(node,close);return node;
  }
  function empty(text){return `<div class="wms-empty">${esc(text)}</div>`}
  function inventoryRows(){
    const rows=[];wms.boxes.forEach(box=>(box.items||[]).forEach(item=>rows.push({box,item,warehouse:warehouseName(box.warehouseId),zone:(findZone(box.warehouseId,box.zoneId)||{}).name||box.zoneId||'—'})));return rows;
  }
  function findZone(warehouseId,zoneId){return warehouses().find(item=>item.id===warehouseId)?.zones?.find(zone=>zone.id===zoneId)||((warehouseId===activeWarehouseId())?zones.find(zone=>zone.id===zoneId):null)}

  const originalLoginView=window.loginView;
  const originalShell=window.shell;
  const originalBindCommon=window.bindCommon;
  const originalPersist=window.persist;
  const originalManagementPanel=window.managementPanel;
  const originalRenderObjects=window.renderObjects;
  const originalBindWorkspace=window.bindWorkspace;
  const originalPointerDown=window.onPointerDown;
  const originalPointerMove=window.onPointerMove;
  const originalPointerUp=window.onPointerUp;
  const originalFloorClick=window.onFloorClick;

  window.loginView=function(){
    root.innerHTML=`<main class="login"><section class="card"><div class="login-mark">B</div><div class="eyebrow">B-FBS</div><h1>Вход в систему</h1><p class="desc">Централизованная складская система</p><form class="form" id="login-form"><label>Логин<input id="login" autocomplete="username" required></label><label>Пароль<input id="password" type="password" autocomplete="current-password" required></label><div id="login-error"></div><button class="btn primary" type="submit">Войти</button></form><div class="login-connection" id="login-connection">Проверка сервера…</div></section></main>`;
    const status=document.getElementById('login-connection');if(status)status.textContent=backendAvailable?(backendHealth?.storage==='ephemeral'?'Сервер доступен · требуется постоянный диск':'Сервер и общая база доступны'):'Автономный режим · данные этого устройства';
    document.getElementById('login-form').onsubmit=async event=>{
      event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;const login=document.getElementById('login').value,password=document.getElementById('password').value,error=document.getElementById('login-error');error.innerHTML='';
      try{
        if(backendAvailable){
          const result=await requestApi('/api/auth/login',{method:'POST',body:JSON.stringify({login,password})});
          sessionStorage.setItem(TOKEN_KEY,result.token);sessionStorage.setItem(USER_KEY,JSON.stringify(result.user));sessionStorage.setItem(AUTH_KEY,'admin');currentUser=result.user;await pullState(true);location.reload();return;
        }
        if(login===ADMIN_LOGIN&&password===ADMIN_PASSWORD){currentUser={id:'local-admin',login:'Admin1',name:'Администратор',role:'admin',active:true};sessionStorage.setItem(USER_KEY,JSON.stringify(currentUser));sessionStorage.setItem(AUTH_KEY,'admin');window.render();return}
        throw new Error('В автономном режиме доступен только локальный администратор.');
      }catch(err){error.innerHTML=`<div class="error">${esc(err.message)}</div>`;button.disabled=false}
    };
  };

  window.shell=function(content){
    const user=currentUser||{name:'Администратор',login:'Admin1',role:'admin'};if(!allowed(activeTab))activeTab='dashboard';
    const tabs=TABS.filter(tab=>allowed(tab[0]));
    return `<div class="app"><aside class="side"><div class="brand"><div class="mark">B</div><div><div class="name">B-FBS</div><div class="sub">Складская система</div></div></div><nav class="nav">${tabs.map((tab,index)=>`<button class="nav-item ${activeTab===tab[0]?'active':''}" data-tab="${tab[0]}"><span class="num">${String(index+1).padStart(2,'0')}</span>${esc(tab[1])}</button>`).join('')}</nav><div class="foot"><span id="connection-badge" class="connection-badge">…</span><div>${esc(user.name||user.login)} · ${esc(roleName(user.role))}</div></div></aside><section class="main"><header class="top"><div><div class="eyebrow">РАБОЧАЯ СИСТЕМА</div><h1 class="title">${esc(TABS.find(tab=>tab[0]===activeTab)?.[1]||'B-FBS')}</h1></div><div class="user"><button class="btn" id="top-api">API Интеграция</button><div class="avatar">${esc((user.name||user.login||'U').slice(0,1).toUpperCase())}</div><span class="user-caption">${esc(user.name||user.login)}<small>${esc(roleName(user.role))}</small></span><button class="btn" id="logout">Выйти</button></div></header><main class="content">${content}</main></section></div>`;
  };

  window.dashboardView=function(){
    const inventory=inventoryRows(),total=inventory.reduce((sum,row)=>sum+Number(row.item.quantity||0),0),openTasks=wms.tasks.filter(task=>!['done','cancelled'].includes(task.status)).length,ready=wms.tasks.filter(task=>task.status==='ready').length,done=wms.tasks.filter(task=>task.status==='done').length,low=wms.boxes.filter(box=>(box.items||[]).reduce((sum,item)=>sum+Number(item.quantity||0),0)<=3).length;
    return `<div class="dashboard"><div class="welcome"><div><h2>Оперативная сводка</h2><p>Общие данные всех подключенных рабочих мест.</p></div><div class="date">${backendAvailable?'Центральная база подключена':'Автономный режим'}</div></div><div class="metrics"><div class="metric"><div class="metric-label">Задания</div><div class="metric-value">${openTasks}</div><div class="metric-note">В очереди и работе</div></div><div class="metric"><div class="metric-label">Готовые задания</div><div class="metric-value">${ready}</div><div class="metric-note">Готовы к отгрузке</div></div><div class="metric"><div class="metric-label">Завершенные</div><div class="metric-value">${done}</div><div class="metric-note">Закрытые задания</div></div><div class="metric"><div class="metric-label">Остатки</div><div class="metric-value">${total}</div><div class="metric-note">Единиц в ${wms.boxes.length} коробках</div></div></div><div class="panels"><div class="panel"><div class="panel-head"><div class="panel-title">Состояние склада</div><div class="panel-link">Сейчас</div></div><div class="status-list"><div class="status-row"><span>Складов</span><b>${warehouses().length}</b></div><div class="status-row"><span>Номенклатура</span><b>${wms.nomenclature.length}</b></div><div class="status-row"><span>Коробки с низким остатком</span><b>${low}</b></div><div class="status-row"><span>Активные ревизии</span><b>${wms.revisions.filter(item=>item.status!=='done').length}</b></div></div></div><div class="panel"><div class="panel-head"><div class="panel-title">Последние события</div></div><div class="event-list">${wms.events.length?wms.events.slice(0,8).map(event=>`<div><span>${esc(event.text)}</span><small>${dateText(event.at)}</small></div>`).join(''):empty('Событий пока нет')}</div></div></div></div>`;
  };

  function inventoryView(){
    const current=activeWarehouseId()||warehouses()[0]?.id||'';
    return `<section class="wms-page"><div class="wms-page-head"><div><h2>Учет склада</h2><p>Только фактическое хранение в выбранном складе: зоны, коробки и остатки.</p></div><div class="wms-actions">${currentUser?.role==='admin'||currentUser?.role==='manager'?'<button class="btn" id="import-nomenclature">Импорт WB</button>':''}<button class="btn" id="bulk-replenish">Массовое пополнение</button><button class="btn primary" id="stock-replenish">Пополнение</button></div></div><div class="inventory-warehouse-bar"><div><span>Рабочий склад</span><strong id="inventory-warehouse-name">${esc(warehouseName(current))}</strong></div><select id="inventory-warehouse">${warehouses().map(item=>`<option value="${esc(item.id)}" ${item.id===current?'selected':''}>${esc(item.name)}</option>`).join('')}</select></div><div class="wms-filters inventory-storage-filters"><div class="quick-search"><input id="inventory-search" autocomplete="off" placeholder="Поиск внутри выбранного склада: ШК, артикул, размер, зона или коробка"><div id="inventory-quick-results" class="quick-search-results" hidden></div></div></div><div class="wms-table-wrap"><table class="wms-table"><thead><tr><th>ШК</th><th>Артикул</th><th>Размер</th><th>Количество</th><th>Зона</th><th>Коробка</th><th>Обновлено</th></tr></thead><tbody id="inventory-body"></tbody></table></div></section>`;
  }

  function accountView(){
    const admin=currentUser?.role==='admin';
    return `<section class="wms-page">
      <div class="wms-page-head">
        <div><h2>Сотрудники</h2><p>Учетные записи и роли хранятся на сервере.</p></div>
        ${admin?'<button class="btn primary" id="add-user">+ Добавить сотрудника</button>':''}
      </div>
      <div id="users-content">${backendAvailable?'Загрузка…':empty('Добавление пользователей доступно при подключении к серверу.')}</div>

      <div class="wms-subsection migration-section">
        <div class="panel-head">
          <div>
            <div class="panel-title">Перенос данных</div>
            <div class="migration-note">Одноразовый перенос текущего склада из старой GitHub Pages-версии в центральную серверную базу.</div>
          </div>
          <span class="status-pill ${backendAvailable?'ok':'muted'}">${backendAvailable?'Сервер подключен':'Локальная версия'}</span>
        </div>
        <div class="migration-actions">
          <div class="migration-action-card">
            <div><b>1. Скачать локальную копию</b><small>Откройте старую версию B-FBS на устройстве, где уже есть склад, и скачайте JSON-копию.</small></div>
            <button type="button" class="btn" id="export-local-backup">Скачать локальную копию</button>
          </div>
          <div class="migration-arrow">→</div>
          <div class="migration-action-card ${backendAvailable&&admin?'':'disabled'}">
            <div><b>2. Загрузить в центральную базу</b><small>${backendAvailable?'Импорт заменит серверное состояние данными из выбранной копии.':'Откройте Railway-версию B-FBS, чтобы выполнить импорт.'}</small></div>
            <button type="button" class="btn primary" id="import-local-backup" ${backendAvailable&&admin?'':'disabled'}>Загрузить копию</button>
          </div>
        </div>
      </div>

      <div class="wms-subsection">
        <div class="panel-head"><div class="panel-title">Журнал системы</div><button class="btn" id="export-data" ${backendAvailable&&admin?'':'disabled'}>Серверная копия</button></div>
        <div id="audit-content">${backendAvailable?'Загрузка…':'Нет соединения с сервером'}</div>
      </div>
    </section>`;
  }

  window.placeholderView=function(tab){
    if(tab?.[0]==='inventory')return inventoryView();
    if(tab?.[0]==='account')return accountView();
    if(tab?.[0]==='transfer')return transferView();
    if(tab?.[0]==='revision')return revisionView();
    if(tab?.[0]==='tasks')return tasksView();
    return `<div class="panel empty-section"><div class="panel-title">${esc(tab?.[1]||'Раздел')}</div><p>Раздел готовится.</p></div>`;
  };

  window.persist=function(){const result=originalPersist.apply(this,arguments);scheduleSync();return result};

  window.bindCommon=function(){
    originalBindCommon();updateConnectionBadge();
    document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{if(allowed(button.dataset.tab)){activeTab=button.dataset.tab;window.render()}}));
    document.getElementById('logout')?.addEventListener('click',async()=>{try{if(backendAvailable&&token())await requestApi('/api/auth/logout',{method:'POST',body:'{}'})}catch(_){}sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(USER_KEY);sessionStorage.removeItem(AUTH_KEY);currentUser=null;window.render()});
    bindInventory();bindAccount();bindTransfers();bindRevisions();bindTasks();
  };

  function inventoryWarehouseId(){
    return document.getElementById('inventory-warehouse')?.value||activeWarehouseId()||warehouses()[0]?.id||'';
  }
  function inventoryWarehouseRows(){
    const warehouseId=inventoryWarehouseId();
    return inventoryRows().filter(row=>row.box.warehouseId===warehouseId);
  }
  function renderInventoryTable(){
    const body=document.getElementById('inventory-body');if(!body)return;
    const query=(document.getElementById('inventory-search')?.value||'').trim().toLowerCase();
    const rows=inventoryWarehouseRows().filter(row=>!query||[row.item.barcode,row.item.article,row.item.size,row.zone,row.box.id].some(value=>String(value||'').toLowerCase().includes(query)));
    body.innerHTML=rows.length?rows.map(row=>`<tr><td>${esc(row.item.barcode)}</td><td><b>${esc(row.item.article)}</b></td><td>${esc(row.item.size)}</td><td><b>${Number(row.item.quantity||0)}</b></td><td>${esc(row.zone)}</td><td><button class="table-link" data-open-box="${esc(row.box.id)}">${esc(row.box.id)}</button></td><td>${dateText(row.box.updatedAt)}</td></tr>`).join(''):`<tr><td colspan="7">${empty('На выбранном складе нет остатков по этим условиям')}</td></tr>`;
    body.querySelectorAll('[data-open-box]').forEach(button=>button.onclick=()=>openBox(button.dataset.openBox));
  }
  function skuStockRows(sku,warehouseId=''){
    return inventoryRows().filter(row=>row.item.barcode===sku.barcode&&(!warehouseId||row.box.warehouseId===warehouseId));
  }
  function openSkuQuickView(sku,warehouseId=inventoryWarehouseId()){
    const rows=skuStockRows(sku,warehouseId),total=rows.reduce((sum,row)=>sum+Number(row.item.quantity||0),0);
    openModal(`${sku.article} · ${sku.size}`,`<div class="quick-sku-head"><span class="status-pill ${total?'':'muted'}">${total?total+' ед.':'Нет остатка'}</span><p>${esc(warehouseName(warehouseId))} · ШК: ${esc(sku.barcode)}</p></div><div class="wms-table-wrap"><table class="wms-table"><thead><tr><th>Зона</th><th>Коробка</th><th>Остаток</th></tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td>${esc(row.zone)}</td><td><button type="button" class="table-link" data-quick-box="${esc(row.box.id)}">${esc(row.box.id)}</button></td><td><b>${Number(row.item.quantity||0)}</b></td></tr>`).join(''):`<tr><td colspan="3">${empty('На этом складе позиция не хранится.')}</td></tr>`}</tbody></table></div><div class="modal-actions"><button type="button" class="btn" data-close>Закрыть</button></div>`,(modal)=>{modal.querySelectorAll('[data-quick-box]').forEach(button=>button.addEventListener('click',()=>openBox(button.dataset.quickBox)))});
  }
  function renderInventoryQuickSearch(){
    const input=document.getElementById('inventory-search'),host=document.getElementById('inventory-quick-results');
    if(!input||!host)return;
    const query=input.value.trim().toLowerCase();
    if(query.length<2){host.hidden=true;host.innerHTML='';return}
    const warehouseId=inventoryWarehouseId();
    const groups=new Map();
    inventoryWarehouseRows().forEach(row=>{
      const key=row.item.barcode;
      const current=groups.get(key)||{sku:{id:key,article:row.item.article,barcode:row.item.barcode,size:row.item.size},qty:0,zones:new Set(),boxes:new Set()};
      current.qty+=Number(row.item.quantity||0);current.zones.add(row.zone);current.boxes.add(row.box.id);groups.set(key,current);
    });
    const results=[...groups.values()].filter(group=>[group.sku.article,group.sku.barcode,group.sku.size,...group.zones,...group.boxes].some(value=>String(value||'').toLowerCase().includes(query))).slice(0,12);
    host.innerHTML=results.length?results.map(group=>`<button type="button" class="quick-search-item" data-quick-barcode="${esc(group.sku.barcode)}"><span><b>${esc(group.sku.article)}</b><small>${esc(group.sku.barcode)} · размер ${esc(group.sku.size)}</small></span><span class="quick-search-stock">${group.qty} ед.<small>${[...group.zones].slice(0,2).map(esc).join(' / ')} · ${group.boxes.size} кор.</small></span></button>`).join(''):`<div class="quick-search-empty">На выбранном складе ничего не найдено</div>`;
    host.hidden=false;
    host.querySelectorAll('[data-quick-barcode]').forEach(button=>button.addEventListener('click',()=>{const item=inventoryWarehouseRows().find(row=>row.item.barcode===button.dataset.quickBarcode)?.item;host.hidden=true;if(item)openSkuQuickView(item,warehouseId)}));
  }
  function bindInventory(){
    const search=document.getElementById('inventory-search'),warehouse=document.getElementById('inventory-warehouse');
    if(search){
      search.oninput=()=>{renderInventoryTable();renderInventoryQuickSearch()};
      search.onfocus=renderInventoryQuickSearch;
      search.onblur=()=>setTimeout(()=>{const host=document.getElementById('inventory-quick-results');if(host)host.hidden=true},140);
      document.getElementById('inventory-quick-results')?.addEventListener('mousedown',event=>event.preventDefault());
    }
    if(warehouse){
      warehouse.onchange=()=>{
        localStorage.setItem(ACTIVE_WAREHOUSE_KEY,warehouse.value);
        const name=document.getElementById('inventory-warehouse-name');if(name)name.textContent=warehouseName(warehouse.value);
        if(search)search.value='';
        renderInventoryTable();renderInventoryQuickSearch();
      };
    }
    renderInventoryTable();
    document.getElementById('import-nomenclature')?.addEventListener('click',openImport);
    document.getElementById('bulk-replenish')?.addEventListener('click',openBulkReplenishment);
    document.getElementById('stock-replenish')?.addEventListener('click',openReplenishment);
  }

  function openNomenclatureForm(){
    openModal('Новая позиция',`<form class="wms-form" id="nomenclature-form"><label>Артикул<input name="article" required></label><label>Баркод<input name="barcode" required inputmode="numeric"></label><label>Размер<input name="size" required></label><div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Сохранить</button></div></form>`,(modal,close)=>{modal.querySelector('form').onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));if(wms.nomenclature.some(item=>item.barcode===data.barcode)){toast('Такой баркод уже существует.','warning');return}wms.nomenclature.push({id:uid('SKU'),article:data.article.trim(),barcode:data.barcode.trim(),size:data.size.trim(),updatedAt:new Date().toISOString()});saveWms(`Добавлена номенклатура ${data.article}`);close();window.render()}});
  }
  function parseDelimited(text){
    const first=(text.split(/\r?\n/,1)[0]||''),delimiter=(first.match(/\t/g)||[]).length>(first.match(/;/g)||[]).length?'\t':((first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',');let rows=[],row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(char===delimiter&&!quoted){row.push(cell);cell=''}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);row=[];cell=''}else cell+=char}row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);return rows;
  }
  function normalizeHeader(value){return String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]/g,'')}
  function rowsToNomenclature(rows){
    if(!rows?.length)return {items:[],error:'Файл пуст.'};const headers=rows[0].map(normalizeHeader);
    const find=candidates=>headers.findIndex(header=>candidates.some(candidate=>header.includes(candidate)));
    const article=find(['артикулпродавца','артикул','vendorcode']),barcode=find(['баркод','штрихкод','шк','sku']),size=find(['размер','techsize','wbsize']);
    if(article<0||barcode<0||size<0)return {items:[],error:'Не найдены колонки Артикул, Баркод и Размер.'};
    const items=rows.slice(1).map(row=>({article:String(row[article]||'').trim(),barcode:String(row[barcode]||'').replace(/\.0$/,'').trim(),size:String(row[size]||'').trim()})).filter(item=>item.article&&item.barcode&&item.size);return {items};
  }
  function workbookRows(arrayBuffer){
    if(!window.XLSX)throw new Error('Модуль Excel не загружен. Обновите страницу и повторите попытку.');
    const workbook=XLSX.read(arrayBuffer,{type:'array',cellDates:false});
    const sheetName=workbook.SheetNames.find(name=>workbook.Sheets[name]?.['!ref'])||workbook.SheetNames[0];
    if(!sheetName)throw new Error('В книге Excel нет листов.');
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:false,defval:''});
  }
  function openImport(){
    openModal('Импорт номенклатуры WB',`<p>Загрузите CSV, TSV, XLSX или XLS. Excel обрабатывается прямо на этом устройстве и работает в автономном режиме. Будут использованы только столбцы «Артикул», «Баркод» и «Размер».</p><div class="import-drop"><input id="wb-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls"><div id="import-preview">Файл не выбран</div></div><div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-import" disabled>Импортировать</button></div>`,(modal,close)=>{
      let parsed=[];const input=modal.querySelector('#wb-file'),preview=modal.querySelector('#import-preview'),confirm=modal.querySelector('#confirm-import');
      input.onchange=async()=>{
        const file=input.files[0];if(!file)return;
        preview.textContent='Чтение файла…';
        try{
          if(file.size>10*1024*1024)throw new Error('Файл слишком большой. Максимальный размер — 10 МБ.');
          let rows;
          if(/\.xlsx?$/i.test(file.name)){
            rows=workbookRows(await file.arrayBuffer());
          }else{
            rows=parseDelimited(await file.text());
          }
          const result=rowsToNomenclature(rows);
          if(result.error)throw new Error(result.error);
          parsed=result.items;
          preview.innerHTML=`<b>Распознано: ${parsed.length}</b><small>${parsed.slice(0,5).map(item=>`${esc(item.article)} · ${esc(item.barcode)} · ${esc(item.size)}`).join('<br>')}</small>`;
          confirm.disabled=!parsed.length;
        }catch(error){
          parsed=[];confirm.disabled=true;
          preview.innerHTML=`<span class="error-text">${esc(error.message)}</span>`;
        }
      };
      confirm.onclick=()=>{
        const byBarcode=new Map(wms.nomenclature.map(item=>[item.barcode,item]));let added=0,updated=0;
        parsed.forEach(item=>{
          const existing=byBarcode.get(item.barcode);
          if(existing){Object.assign(existing,item,{updatedAt:new Date().toISOString()});updated++}
          else{const created={id:uid('SKU'),...item,updatedAt:new Date().toISOString()};wms.nomenclature.push(created);byBarcode.set(item.barcode,created);added++}
        });
        saveWms(`Импорт WB: добавлено ${added}, обновлено ${updated}`);
        close();toast(`Импортировано: ${added} новых, ${updated} обновлено.`,'success');window.render();
      };
    });
  }

  function permissionCount(user){
    const permissions=userPermissions(user);
    return ALL_PERMISSION_KEYS.filter(key=>permissions[key]).length;
  }
  async function loadUsers(){
    const host=document.getElementById('users-content');if(!host||!backendAvailable)return;
    try{
      const result=await requestApi('/api/users');
      host.innerHTML=`<div class="wms-table-wrap"><table class="wms-table"><thead><tr><th>Сотрудник</th><th>Логин</th><th>Роль</th><th>Доступ</th><th>Последний вход</th><th>Статус</th><th></th></tr></thead><tbody>${result.users.map(user=>`<tr><td><b>${esc(user.name)}</b></td><td>${esc(user.login)}</td><td>${esc(roleName(user.role))}</td><td><span class="permission-count">${user.role==='admin'?'Полный':permissionCount(user)+' / '+ALL_PERMISSION_KEYS.length}</span></td><td>${dateText(user.lastLoginAt)}</td><td><span class="status-pill ${user.active?'ok':'muted'}">${user.active?'Активен':'Отключен'}</span></td><td><button class="table-link" data-edit-user="${esc(user.id)}">Изменить доступ</button></td></tr>`).join('')}</tbody></table></div>`;
      host.querySelectorAll('[data-edit-user]').forEach(button=>button.onclick=()=>openUserForm(result.users.find(user=>user.id===button.dataset.editUser)));
    }catch(error){host.innerHTML=empty(error.message)}
  }
  async function loadAudit(){const host=document.getElementById('audit-content');if(!host||!backendAvailable)return;try{const result=await requestApi('/api/audit');host.innerHTML=`<div class="audit-list">${result.events.slice(0,50).map(event=>`<div><b>${esc(event.name||event.login||'Система')}</b><span>${esc(event.action)}</span><small>${dateText(event.createdAt)}</small></div>`).join('')||'Событий нет'}</div>`}catch(error){host.innerHTML=empty(error.message)}}
  function backupStateFromPayload(payload){
    const state=payload?.state&&typeof payload.state==='object'?payload.state:payload;
    if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Файл не содержит данные B-FBS.');
    if(state.warehouses!=null&&!Array.isArray(state.warehouses))throw new Error('Некорректный список складов.');
    if(state.workspace!=null&&(typeof state.workspace!=='object'||Array.isArray(state.workspace)))throw new Error('Некорректное рабочее пространство.');
    if(!state.wms||typeof state.wms!=='object'||Array.isArray(state.wms))throw new Error('В файле отсутствуют данные WMS.');
    const wmsData=Object.assign({},EMPTY_WMS,state.wms);
    Object.keys(EMPTY_WMS).forEach(key=>{if(!Array.isArray(wmsData[key]))wmsData[key]=[]});
    return {warehouses:state.warehouses??null,workspace:state.workspace??null,wms:wmsData};
  }
  function backupSummary(state){
    const warehouseList=Array.isArray(state?.warehouses)?state.warehouses:[],boxes=state?.wms?.boxes||[];
    return {
      warehouses:warehouseList.length,
      zones:warehouseList.reduce((sum,item)=>sum+(Array.isArray(item?.zones)?item.zones.length:0),0),
      nomenclature:(state?.wms?.nomenclature||[]).length,
      boxes:boxes.length,
      units:boxes.reduce((sum,box)=>sum+(box.items||[]).reduce((inner,item)=>inner+Math.max(0,Number(item.quantity)||0),0),0),
      movements:(state?.wms?.movements||[]).length,
      tasks:(state?.wms?.tasks||[]).length,
      revisions:(state?.wms?.revisions||[]).length
    };
  }
  function downloadJson(filename,payload){
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  function exportLocalBackup(){
    const state=serializeState(),summary=backupSummary(state),stamp=new Date().toISOString().replace(/[:.]/g,'-');
    downloadJson(`b-fbs-local-backup-${stamp}.json`,{
      format:'b-fbs-local-backup-v1',
      exportedAt:new Date().toISOString(),
      source:{origin:location.origin,mode:backendAvailable?'server-client':'local-browser'},
      summary,
      state
    });
    toast(`Локальная копия сохранена: ${summary.warehouses} склад., ${summary.boxes} кор., ${summary.units} ед.`,'success');
  }
  function openBackupImport(){
    if(!backendAvailable||!token()){toast('Импорт доступен только в серверной версии B-FBS.','warning');return}
    if(currentUser?.role!=='admin'){toast('Импорт резервной копии доступен только администратору.','warning');return}
    openModal('Перенос данных в сервер',`
      <div class="backup-import-warning"><b>Центральная база будет заменена</b><p>Выберите JSON-копию, скачанную со старой версии B-FBS. Перед подтверждением система покажет состав файла. Пользователи и пароли сервера не импортируются.</p></div>
      <div class="import-drop backup-import-drop">
        <input id="backup-file" type="file" accept=".json,application/json">
        <div id="backup-preview">Файл не выбран</div>
      </div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button type="button" class="btn primary" id="confirm-backup-import" disabled>Перенести в сервер</button></div>
    `,(modal,close)=>{
      const input=modal.querySelector('#backup-file'),preview=modal.querySelector('#backup-preview'),confirmButton=modal.querySelector('#confirm-backup-import');
      let importedState=null,summary=null;
      input.onchange=async()=>{
        const file=input.files?.[0];if(!file)return;
        importedState=null;summary=null;confirmButton.disabled=true;preview.textContent='Проверка копии…';
        try{
          if(file.size>10*1024*1024)throw new Error('Копия больше 10 МБ. Сначала сообщите об этом — увеличим безопасный лимит.');
          const payload=JSON.parse(await file.text());
          importedState=backupStateFromPayload(payload);
          summary=backupSummary(importedState);
          preview.innerHTML=`<div class="backup-preview-grid">
            <div><span>Склады</span><b>${summary.warehouses}</b></div>
            <div><span>Зоны</span><b>${summary.zones}</b></div>
            <div><span>Номенклатура</span><b>${summary.nomenclature}</b></div>
            <div><span>Коробки</span><b>${summary.boxes}</b></div>
            <div><span>Остаток</span><b>${summary.units} ед.</b></div>
            <div><span>Движения</span><b>${summary.movements}</b></div>
          </div><small class="backup-file-name">${esc(file.name)}</small>`;
          confirmButton.disabled=false;
        }catch(error){
          preview.innerHTML=`<span class="error-text">${esc(error.message)}</span>`;
        }
      };
      confirmButton.onclick=async()=>{
        if(!importedState||!summary)return;
        const ok=window.confirm(`Перенести в центральную базу: ${summary.warehouses} склад., ${summary.boxes} кор., ${summary.units} ед.? Текущее серверное состояние будет заменено.`);
        if(!ok)return;
        confirmButton.disabled=true;confirmButton.textContent='Переносим…';
        try{
          const current=await requestApi('/api/state');
          const result=await requestApi('/api/state/import-backup',{method:'POST',body:JSON.stringify({revision:current.revision,state:importedState})});
          applyState(importedState);
          serverRevision=result.revision;
          localStorage.setItem(REVISION_KEY,String(serverRevision));
          localStorage.removeItem(PENDING_KEY);
          close();
          toast(`Перенос завершен: ${summary.warehouses} склад., ${summary.units} ед. Теперь данные доступны всем устройствам.`,'success');
          setTimeout(()=>location.reload(),650);
        }catch(error){
          confirmButton.disabled=false;confirmButton.textContent='Перенести в сервер';
          toast(error.message,'warning');
        }
      };
    });
  }
  function bindAccount(){
    if(document.getElementById('users-content')){loadUsers();loadAudit()}
    document.getElementById('add-user')?.addEventListener('click',()=>openUserForm());
    document.getElementById('export-local-backup')?.addEventListener('click',exportLocalBackup);
    document.getElementById('import-local-backup')?.addEventListener('click',openBackupImport);
    document.getElementById('export-data')?.addEventListener('click',async()=>{
      if(!backendAvailable)return;
      try{
        const data=await requestApi('/api/export');
        downloadJson(`b-fbs-server-backup-${new Date().toISOString().slice(0,10)}.json`,data);
      }catch(error){toast(error.message,'warning')}
    });
  }
  function permissionEditorHtml(role,permissions){
    const values={...defaultPermissions(role),...(permissions||{})};
    const groups=[
      ['Разделы',['dashboard_view','workspace_view','inventory_view','transfers_view','revisions_view','tasks_view']],
      ['Склад и хранение',['layout_manage','zones_manage','inventory_manage','nomenclature_manage']],
      ['Операции',['transfers_manage','revisions_manage','tasks_manage','tasks_pick']]
    ];
    const locked=role==='admin';
    return `<div class="permission-editor" id="permission-editor">
      <div class="permission-editor-head"><div><b>Доступ сотрудника</b><small>Роль задает стартовый шаблон. Ниже можно включить или отключить каждую функцию отдельно.</small></div><button type="button" class="btn permission-reset" id="permission-reset" ${locked?'disabled':''}>Сбросить по роли</button></div>
      ${groups.map(([title,keys])=>`<div class="permission-group"><div class="permission-group-title">${title}</div><div class="permission-grid">${keys.map(key=>{const [label,note]=PERMISSION_LABELS[key];return `<label class="permission-item ${locked?'locked':''}"><input type="checkbox" data-permission-key="${key}" ${values[key]?'checked':''} ${locked?'disabled':''}><span><b>${esc(label)}</b><small>${esc(note)}</small></span></label>`}).join('')}</div></div>`).join('')}
      ${locked?'<div class="permission-admin-note">У роли «Администратор» всегда полный доступ. Это нельзя отключить отдельными переключателями.</div>':''}
    </div>`;
  }
  function syncPermissionEditor(modal,role,permissions){
    const host=modal.querySelector('#permission-editor');
    if(!host)return;
    const wrapper=document.createElement('div');
    wrapper.innerHTML=permissionEditorHtml(role,permissions);
    host.replaceWith(wrapper.firstElementChild);
    modal.querySelector('#permission-reset')?.addEventListener('click',()=>syncPermissionEditor(modal,role,defaultPermissions(role)));
  }
  function openUserForm(user){
    const initialRole=user?.role||'picker';
    openModal(user?'Сотрудник':'Новый сотрудник',`<form class="wms-form user-access-form" id="user-form">
      <div class="user-fields-grid">
        <label>Имя<input name="name" value="${esc(user?.name||'')}" required></label>
        <label>Логин<input name="login" value="${esc(user?.login||'')}" required></label>
        <label>Роль<select name="role">${Object.entries(ROLE_NAMES).map(([value,label])=>`<option value="${value}" ${initialRole===value?'selected':''}>${label}</option>`).join('')}</select></label>
        <label>Пароль ${user?'<small>оставьте пустым без изменения</small>':''}<input name="password" type="password" ${user?'':'required'} minlength="8"></label>
      </div>
      ${permissionEditorHtml(initialRole,user?.permissions)}
      ${user?`<label class="check-row"><input name="active" type="checkbox" ${user.active?'checked':''}> Учетная запись активна</label>`:''}
      <div class="form-error"></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>`,(modal,close)=>{
      const form=modal.querySelector('form'),roleSelect=form.elements.role;
      roleSelect.addEventListener('change',()=>syncPermissionEditor(modal,roleSelect.value,defaultPermissions(roleSelect.value)));
      modal.querySelector('#permission-reset')?.addEventListener('click',()=>syncPermissionEditor(modal,roleSelect.value,defaultPermissions(roleSelect.value)));

      form.onsubmit=async event=>{
        event.preventDefault();
        const data=Object.fromEntries(new FormData(form));
        data.permissions={};
        ALL_PERMISSION_KEYS.forEach(key=>{
          const input=modal.querySelector(`[data-permission-key="${key}"]`);
          data.permissions[key]=roleSelect.value==='admin'?true:!!input?.checked;
        });
        if(user)data.active=form.elements.active.checked;
        try{
          const result=await requestApi(user?`/api/users/${encodeURIComponent(user.id)}`:'/api/users',{method:user?'PATCH':'POST',body:JSON.stringify(data)});
          if(user?.id===currentUser?.id){
            currentUser=result.user;sessionStorage.setItem(USER_KEY,JSON.stringify(currentUser));
          }
          close();toast('Учетная запись и права доступа сохранены.','success');loadUsers();
        }catch(error){form.querySelector('.form-error').innerHTML=`<div class="error">${esc(error.message)}</div>`}
      };
    });
  }

  window.apiModal=function(){
    openModal('Интеграция Wildberries',`<div class="api-status-card"><span class="status-pill" id="wb-api-status">Проверка…</span><h3>Безопасное подключение WB</h3><p>Номенклатура уже импортируется из выгрузки WB Seller в разделе «Учет склада». API-ключ хранится только на сервере в переменной <code>WB_API_TOKEN</code> и никогда не передается в браузер.</p><div class="modal-actions"><button class="btn" data-close>Закрыть</button>${['admin','manager'].includes(currentUser?.role)?'<button class="btn primary" id="go-wb-import">Открыть импорт WB</button>':''}</div></div>`,async(modal,close)=>{const status=modal.querySelector('#wb-api-status');if(backendAvailable){try{const result=await requestApi('/api/wb/status');status.textContent=result.configured?'API-ключ задан на сервере':'Работа через импорт файла';status.classList.toggle('ok',result.configured)}catch(error){status.textContent=error.message}}else status.textContent='Автономный режим';modal.querySelector('#go-wb-import')?.addEventListener('click',()=>{close();activeTab='inventory';render();setTimeout(openImport,0)})});
  };

  function skuOptions(selected=''){
    return wms.nomenclature.map(item=>`<option value="${esc(item.barcode)}" ${item.barcode===selected?'selected':''}>${esc(item.article)} · ${esc(item.size)} · ${esc(item.barcode)}</option>`).join('');
  }
  function itemByBarcode(barcode){return wms.nomenclature.find(item=>item.barcode===String(barcode||'').trim())}
  function boxQuantity(box){return (box?.items||[]).reduce((sum,item)=>sum+Number(item.quantity||0),0)}
  function boxByQr(value){const normalized=String(value||'').trim();return wms.boxes.find(box=>box.id===normalized||box.qrCode===normalized)}
  function upsertBoxItem(box,sku,quantity){
    let item=(box.items||[]).find(row=>row.barcode===sku.barcode);if(!item){item={article:sku.article,barcode:sku.barcode,size:sku.size,quantity:0};box.items.push(item)}
    item.quantity=Math.max(0,Number(item.quantity||0)+Number(quantity||0));box.updatedAt=new Date().toISOString();return item;
  }
  function statusLabel(status){return ({new:'Новая',in_transit:'В пути',received:'Получена',cancelled:'Отменена',queued:'В очереди',working:'В работе',ready:'Готово',done:'Завершено'}[status]||status)}
  function warehouseOptions(selected='',exclude=''){return warehouses().filter(item=>item.id!==exclude).map(item=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.name)}</option>`).join('')}
  function zoneOptions(warehouseId,selected=''){return (warehouses().find(item=>item.id===warehouseId)?.zones||((warehouseId===activeWarehouseId())?zones:[])).map(zone=>`<option value="${esc(zone.id)}" ${zone.id===selected?'selected':''}>${esc(zone.name)}</option>`).join('')}

  window.managementPanel=function(){
    if(workspaceMode!=='management')return originalManagementPanel();
    const canLayout=can('layout_manage'),canZones=can('zones_manage');
    return `<div class="stage-indicator"><span class="stage-number">✓</span><div><b>Рабочая схема</b><small>Опубликованная версия</small></div></div>
      <p class="hint">${canLayout||canZones?'Доступ на изменение определяется персональными правами сотрудника.':'Режим просмотра: изменение планировки и зон для вашей учетной записи отключено.'}</p>
      ${canLayout?'<button class="btn primary wide" id="edit-copy">Создать копию для редактирования</button>':''}
      <div class="object-section"><div class="panel-title">Зоны хранения · ${zones.length}</div>
        <p class="hint">${canZones?'Можно создавать и редактировать зоны хранения.':'Зоны доступны только для просмотра.'}</p>
        ${canZones?'<button class="btn wide" id="wms-add-zone">+ Нарисовать зону</button>':''}
        <div class="zone-side-list">${zones.map(zone=>`<div class="zone-side-item"><button class="zone-side-main" data-open-zone="${esc(zone.id)}"><span>${esc(zone.name)}</span><small>${wms.boxes.filter(box=>box.warehouseId===activeWarehouseId()&&box.zoneId===zone.id).length} кор.</small></button>${canZones?`<button type="button" class="zone-side-edit" data-edit-zone="${esc(zone.id)}" title="Редактировать зону">Редактировать зону</button>`:''}</div>`).join('')||'<small>Зон пока нет</small>'}</div>
      </div>
      <div class="object-section"><div class="panel-title">Версии</div><div class="version-list">${versions.length?versions.slice().reverse().map(v=>`<div><b>v${v.version}</b><span>${esc(v.date)}</span></div>`).join(''):'Нет сохранённых версий'}</div></div>`;
  };
  function shortenZoneName(name,maxChars){
    const value=String(name||'Зона').trim()||'Зона';
    if(value.length<=maxChars)return value;
    return maxChars<=4?value.slice(0,Math.max(1,maxChars)):value.slice(0,maxChars-1).trimEnd()+'…';
  }
  function zoneLabelSvg(zone,count,index){
    const vertical=zone.h>zone.w*1.45&&zone.w<115;
    const compact=!vertical&&(zone.h<72||zone.w<115);
    const available=vertical?Math.max(36,zone.h-26):Math.max(36,zone.w-24);
    const fontSize=compact?Math.max(9,Math.min(12,zone.h*.23)):12;
    const charWidth=fontSize*.62;
    const title=shortenZoneName(zone.name,Math.max(4,Math.floor(available/charWidth)));
    const meta=`${count} кор. · лимит ${Number(zone.capacity||0)||'∞'}`;
    const clipId=`zone-label-clip-${index}`;

    if(vertical){
      const cx=zone.x+zone.w/2,cy=zone.y+zone.h/2;
      const showMeta=zone.h>=120&&zone.w>=48;
      return `<defs><clipPath id="${clipId}"><rect x="${zone.x+5}" y="${zone.y+5}" width="${Math.max(1,zone.w-10)}" height="${Math.max(1,zone.h-10)}" rx="5"/></clipPath></defs><g class="zone-label zone-label-vertical" clip-path="url(#${clipId})" transform="translate(${cx} ${cy}) rotate(-90)"><text class="zone-title" x="0" y="${showMeta?-4:3}" text-anchor="middle" dominant-baseline="middle">${esc(title)}</text>${showMeta?`<text class="zone-count" x="0" y="12" text-anchor="middle" dominant-baseline="middle">${esc(meta)}</text>`:''}</g>`;
    }

    if(compact){
      return `<defs><clipPath id="${clipId}"><rect x="${zone.x+6}" y="${zone.y+5}" width="${Math.max(1,zone.w-12)}" height="${Math.max(1,zone.h-10)}" rx="5"/></clipPath></defs><g class="zone-label zone-label-compact" clip-path="url(#${clipId})"><text class="zone-title" x="${zone.x+zone.w/2}" y="${zone.y+zone.h/2}" text-anchor="middle" dominant-baseline="middle" style="font-size:${fontSize}px">${esc(title)}</text></g>`;
    }

    const showMeta=zone.h>=76;
    return `<defs><clipPath id="${clipId}"><rect x="${zone.x+8}" y="${zone.y+7}" width="${Math.max(1,zone.w-16)}" height="${Math.max(1,Math.min(zone.h-14,50))}" rx="5"/></clipPath></defs><g class="zone-label zone-label-standard" clip-path="url(#${clipId})"><text class="zone-title" x="${zone.x+12}" y="${zone.y+22}">${esc(title)}</text>${showMeta?`<text class="zone-count" x="${zone.x+12}" y="${zone.y+39}">${esc(meta)}</text>`:''}</g>`;
  }
  function zonesSvg(){
    if(workspaceMode!=='management')return '';
    const warehouseId=activeWarehouseId();
    return zones.map((zone,zoneIndex)=>{
      const boxes=wms.boxes.filter(box=>box.warehouseId===warehouseId&&box.zoneId===zone.id);
      const count=boxes.length;
      const edit='';
      const markersAllowed=zone.w>=76&&zone.h>=72;
      const markers=markersAllowed?boxes.slice(0,18).map((box,index)=>{const col=index%6,row=Math.floor(index/6);return `<circle class="box-dot" data-box-id="${esc(box.id)}" cx="${zone.x+18+col*18}" cy="${zone.y+zone.h-16-row*18}" r="6"><title>${esc(box.id)} · ${boxQuantity(box)} ед.</title></circle>`}).join(''):'';
      const handles=zoneMoveId===zone.id?`<g class="zone-edit-handles"><circle class="zone-edit-handle nw" data-zone-resize="nw" cx="${zone.x}" cy="${zone.y}" r="7"/><circle class="zone-edit-handle ne" data-zone-resize="ne" cx="${zone.x+zone.w}" cy="${zone.y}" r="7"/><circle class="zone-edit-handle sw" data-zone-resize="sw" cx="${zone.x}" cy="${zone.y+zone.h}" r="7"/><circle class="zone-edit-handle se" data-zone-resize="se" cx="${zone.x+zone.w}" cy="${zone.y+zone.h}" r="7"/></g>`:'';
      return `<g class="wms-zone ${zone.locked?'locked':''} ${zone.frozen?'frozen':''} ${zoneMoveId===zone.id?'move-enabled':''}" data-zone-id="${esc(zone.id)}"><rect class="zone-body" x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="8"/><title>${esc(zone.name)} · ${count} кор. · лимит ${Number(zone.capacity||0)||'∞'}</title>${zoneLabelSvg(zone,count,zoneIndex)}${edit}${markers}${handles}</g>`;
    }).join('');
  }
  window.renderObjects=function(objects){return originalRenderObjects(objects)+zonesSvg()};
  function publishedBoundsLocal(){
    const walls=published?.walls||[];if(!walls.length)return null;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    walls.forEach(wall=>{if(wall.type==='line'){minX=Math.min(minX,wall.x1,wall.x2);minY=Math.min(minY,wall.y1,wall.y2);maxX=Math.max(maxX,wall.x1,wall.x2);maxY=Math.max(maxY,wall.y1,wall.y2)}else{minX=Math.min(minX,wall.x);minY=Math.min(minY,wall.y);maxX=Math.max(maxX,wall.x+wall.w);maxY=Math.max(maxY,wall.y+wall.h)}});return {minX,minY,maxX,maxY};
  }
  function validZone(rect,ignoreId=''){
    const b=publishedBoundsLocal();if(!b||rect.w<20||rect.h<20||rect.x<b.minX||rect.y<b.minY||rect.x+rect.w>b.maxX||rect.y+rect.h>b.maxY)return false;
    return !zones.some(zone=>zone.id!==ignoreId&&rect.x<zone.x+zone.w&&rect.x+rect.w>zone.x&&rect.y<zone.y+zone.h&&rect.y+rect.h>zone.y);
  }
  function zoneGridStep(){
    return Math.max(1,(Number(draft?.grid)||0.5)/SCALE);
  }
  function snapZonePoint(point,align=true,ignoreId=''){
    const step=zoneGridStep();
    let x=Math.round(point.x/step)*step,y=Math.round(point.y/step)*step;
    if(align){
      const threshold=Math.min(step*.65,8);
      const xs=[],ys=[];
      zones.filter(zone=>zone.id!==ignoreId).forEach(zone=>{xs.push(zone.x,zone.x+zone.w);ys.push(zone.y,zone.y+zone.h)});
      xs.forEach(value=>{if(Math.abs(x-value)<=threshold)x=value});
      ys.forEach(value=>{if(Math.abs(y-value)<=threshold)y=value});
    }
    return {x,y};
  }
  function snapZonePosition(zone,x,y){
    const step=zoneGridStep(),threshold=Math.min(step*.65,8);
    let nx=Math.round(x/step)*step,ny=Math.round(y/step)*step;
    const xCandidates=[],yCandidates=[];
    zones.filter(item=>item.id!==zone.id).forEach(item=>{
      xCandidates.push(item.x,item.x+item.w,item.x-zone.w,item.x+item.w-zone.w);
      yCandidates.push(item.y,item.y+item.h,item.y-zone.h,item.y+item.h-zone.h);
    });
    xCandidates.forEach(value=>{if(Math.abs(nx-value)<=threshold)nx=value});
    yCandidates.forEach(value=>{if(Math.abs(ny-value)<=threshold)ny=value});
    return {x:nx,y:ny};
  }
  function closeZoneMenu(){
    zoneMenu?.remove();zoneMenu=null;
  }
  function zoneGeometry(zone){
    return zone?{x:zone.x,y:zone.y,w:zone.w,h:zone.h}:null;
  }
  function restoreZoneGeometry(zone,geometry){
    if(zone&&geometry)Object.assign(zone,geometry);
  }
  function startZoneEdit(zone){
    if(!requireClientPermission('zones_manage','У вас нет доступа к редактированию зон.'))return;
    if(!zone||zone.frozen)return;
    if(zoneMoveId&&zoneMoveId!==zone.id){
      toast('Сначала сохраните или отмените изменения текущей зоны.','warning');
      return;
    }
    if(zoneMoveId===zone.id)return;
    zoneMoveId=zone.id;
    zoneEditOriginal=zoneGeometry(zone);
    zoneEditDirty=false;
    zoneMoveStart=null;
    zoneResizeStart=null;
    closeZoneMenu();
    render();
    toast('Редактирование зоны: перемещайте её зажатой ЛКМ или тяните за угловые маркеры.','info');
  }
  function saveZoneEdit(zone){
    if(!zone||zoneMoveId!==zone.id)return;
    persist();
    if(zoneEditDirty)saveWms(`Изменена геометрия зоны ${zone.name}`);
    clearZoneResizePreview();
    zoneMoveId='';zoneEditOriginal=null;zoneEditDirty=false;zoneMoveStart=null;zoneResizeStart=null;
    closeZoneMenu();
    render();
    toast('Изменения зоны сохранены.','success');
  }
  function cancelZoneEdit(){
    if(!zoneMoveId)return;
    const zone=zones.find(item=>item.id===zoneMoveId);
    restoreZoneGeometry(zone,zoneEditOriginal);
    clearZoneResizePreview();
    zoneMoveId='';zoneEditOriginal=null;zoneEditDirty=false;zoneMoveStart=null;zoneResizeStart=null;
    closeZoneMenu();
    render();
    toast('Изменения зоны отменены.','info');
  }
  function setZoneFrozen(zone,frozen){
    if(!requireClientPermission('zones_manage','У вас нет доступа к изменению зон.'))return;
    if(zoneMoveId===zone.id){
      toast('Сначала сохраните или отмените редактирование зоны.','warning');
      return;
    }
    zone.frozen=!!frozen;
    persist();
    saveWms(`${zone.frozen?'Заморожена':'Разморожена'} зона ${zone.name}`);
    render();
  }
  function openZoneActionMenu(zone,event){
    closeZoneMenu();
    if(zoneMoveId&&zoneMoveId!==zone.id){
      toast('Сначала сохраните или отмените изменения редактируемой зоны.','warning');
      return;
    }
    const editing=zoneMoveId===zone.id,canZones=can('zones_manage');
    const menu=document.createElement('div');
    menu.className='zone-action-menu';
    if(editing&&canZones){
      menu.innerHTML=`<div class="zone-action-title"><b>${esc(zone.name)}</b><small>Редактирование активно${zoneEditDirty?' · есть изменения':''}</small></div><button type="button" class="zone-action-save" data-zone-menu="save">Сохранить изменения</button><button type="button" data-zone-menu="cancel">Отменить изменения</button>`;
    }else{
      menu.innerHTML=`<div class="zone-action-title"><b>${esc(zone.name)}</b><small>${canZones?(zone.frozen?'Зафиксирована':'Готова к работе'):'Только просмотр'}</small></div><button type="button" data-zone-menu="open">Открыть зону</button>${canZones?`<button type="button" data-zone-menu="edit" ${zone.frozen?'disabled':''}>Редактировать зону</button><button type="button" data-zone-menu="freeze">${zone.frozen?'Разморозить':'Заморозить'}</button>`:''}`;
    }
    document.body.appendChild(menu);
    const rect=menu.getBoundingClientRect();
    menu.style.left=`${Math.max(8,Math.min(window.innerWidth-rect.width-8,event.clientX+8))}px`;
    menu.style.top=`${Math.max(8,Math.min(window.innerHeight-rect.height-8,event.clientY+8))}px`;
    menu.querySelector('[data-zone-menu="open"]')?.addEventListener('click',()=>{closeZoneMenu();openZoneForm(zone)});
    menu.querySelector('[data-zone-menu="edit"]')?.addEventListener('click',()=>startZoneEdit(zone));
    menu.querySelector('[data-zone-menu="freeze"]')?.addEventListener('click',()=>{closeZoneMenu();setZoneFrozen(zone,!zone.frozen)});
    menu.querySelector('[data-zone-menu="save"]')?.addEventListener('click',()=>saveZoneEdit(zone));
    menu.querySelector('[data-zone-menu="cancel"]')?.addEventListener('click',cancelZoneEdit);
    zoneMenu=menu;
  }
  document.addEventListener('pointerdown',event=>{
    if(zoneMenu&&!event.target.closest('.zone-action-menu')&&!event.target.closest('[data-zone-id]'))closeZoneMenu();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeZoneMenu();if(zoneMoveId)cancelZoneEdit()}});

  function showZonePreview(){
    const svg=document.getElementById('warehouse-svg');if(!svg||!zoneStart||!zoneCurrent)return;
    svg.querySelector('#wms-zone-preview-group')?.remove();
    const x=Math.min(zoneStart.x,zoneCurrent.x),y=Math.min(zoneStart.y,zoneCurrent.y),width=Math.abs(zoneCurrent.x-zoneStart.x),height=Math.abs(zoneCurrent.y-zoneStart.y);
    const ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g');group.id='wms-zone-preview-group';
    const rect=document.createElementNS(ns,'rect');rect.setAttribute('class','wms-zone-preview');rect.setAttribute('x',x);rect.setAttribute('y',y);rect.setAttribute('width',width);rect.setAttribute('height',height);rect.setAttribute('rx','7');group.appendChild(rect);
    if(width>=28&&height>=22){
      const label=`${(width*SCALE).toFixed(1)} × ${(height*SCALE).toFixed(1)} м`;
      const labelWidth=Math.max(76,label.length*6.4+18),cx=x+width/2,cy=y+height/2;
      const badge=document.createElementNS(ns,'rect');badge.setAttribute('class','zone-preview-badge');badge.setAttribute('x',cx-labelWidth/2);badge.setAttribute('y',cy-13);badge.setAttribute('width',labelWidth);badge.setAttribute('height','26');badge.setAttribute('rx','8');group.appendChild(badge);
      const text=document.createElementNS(ns,'text');text.setAttribute('class','zone-preview-size');text.setAttribute('x',cx);text.setAttribute('y',cy+4);text.setAttribute('text-anchor','middle');text.textContent=label;group.appendChild(text);
    }
    svg.appendChild(group);
  }
  function clearZoneResizePreview(){
    document.getElementById('zone-resize-preview')?.remove();
    document.querySelector('.wms-zone.live-resizing')?.classList.remove('live-resizing');
  }
  function syncLiveZoneGeometry(zone){
    const node=[...document.querySelectorAll('[data-zone-id]')].find(item=>item.dataset.zoneId===zone.id);
    if(!node)return;
    node.classList.add('live-resizing');
    const body=node.querySelector('.zone-body');
    if(body){
      body.setAttribute('x',zone.x);
      body.setAttribute('y',zone.y);
      body.setAttribute('width',zone.w);
      body.setAttribute('height',zone.h);
    }
    const handles={
      nw:[zone.x,zone.y],
      ne:[zone.x+zone.w,zone.y],
      sw:[zone.x,zone.y+zone.h],
      se:[zone.x+zone.w,zone.y+zone.h]
    };
    node.querySelectorAll('[data-zone-resize]').forEach(handle=>{
      const point=handles[handle.dataset.zoneResize];
      if(point){handle.setAttribute('cx',point[0]);handle.setAttribute('cy',point[1])}
    });
  }
  function showZoneResizePreview(zone){
    const svg=document.getElementById('warehouse-svg');if(!svg||!zone)return;
    svg.querySelector('#zone-resize-preview')?.remove();
    syncLiveZoneGeometry(zone);
    const ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g');
    group.id='zone-resize-preview';
    const outline=document.createElementNS(ns,'rect');
    outline.setAttribute('class','zone-resize-preview-outline');
    outline.setAttribute('x',zone.x);outline.setAttribute('y',zone.y);
    outline.setAttribute('width',zone.w);outline.setAttribute('height',zone.h);outline.setAttribute('rx','8');
    group.appendChild(outline);

    const label=`${(zone.w*SCALE).toFixed(1)} × ${(zone.h*SCALE).toFixed(1)} м`;
    const labelWidth=Math.max(82,label.length*6.6+20);
    const cx=zone.x+zone.w/2,cy=zone.y+zone.h/2;

    const badge=document.createElementNS(ns,'rect');
    badge.setAttribute('class','zone-preview-badge');
    badge.setAttribute('x',cx-labelWidth/2);badge.setAttribute('y',cy-14);
    badge.setAttribute('width',labelWidth);badge.setAttribute('height','28');badge.setAttribute('rx','8');
    group.appendChild(badge);

    const text=document.createElementNS(ns,'text');
    text.setAttribute('class','zone-preview-size');
    text.setAttribute('x',cx);text.setAttribute('y',cy+4);
    text.setAttribute('text-anchor','middle');
    text.textContent=label;
    group.appendChild(text);
    svg.appendChild(group);
  }
  window.onPointerDown=function(event){
    if(workspaceMode==='management'&&zoneDraw&&event.button===0){
      event.preventDefault();closeZoneMenu();zoneStart=snapZonePoint(floorPoint(event));zoneCurrent={...zoneStart};pointerAction='wms-zone';event.currentTarget.setPointerCapture(event.pointerId);showZonePreview();return
    }
    const zoneNode=event.target.closest?.('[data-zone-id]');
    const resizeNode=event.target.closest?.('[data-zone-resize]');
    if(workspaceMode==='management'&&zoneMoveId&&event.button===0&&resizeNode&&zoneNode?.dataset.zoneId===zoneMoveId){
      const zone=zones.find(item=>item.id===zoneMoveId);
      if(zone&&!zone.frozen){
        event.preventDefault();closeZoneMenu();
        zoneResizeStart={handle:resizeNode.dataset.zoneResize,geometry:zoneGeometry(zone)};
        pointerAction='wms-zone-resize';
        event.currentTarget.classList.add('zone-resizing');
        showZoneResizePreview(zone);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if(workspaceMode==='management'&&zoneMoveId&&event.button===0&&zoneNode?.dataset.zoneId===zoneMoveId&&!event.target.closest?.('[data-box-id]')){
      const zone=zones.find(item=>item.id===zoneMoveId);
      if(zone&&!zone.frozen){
        event.preventDefault();closeZoneMenu();const p=floorPoint(event);
        // A press on the edited zone starts as a click candidate. It turns
        // into a drag only after the pointer actually moves a few pixels.
        zoneMoveStart={pointer:p,x:zone.x,y:zone.y,clientX:event.clientX,clientY:event.clientY};
        zoneMoveChanged=false;
        pointerAction='wms-zone-edit-pending';
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if(workspaceMode==='management'&&event.button===0&&event.target.closest?.('[data-zone-id],[data-box-id]')){pointerAction=null;return}
    return originalPointerDown(event);
  };
  window.onPointerMove=function(event){
    if(pointerAction==='wms-zone'){zoneCurrent=snapZonePoint(floorPoint(event));showZonePreview();return}
    if(pointerAction==='wms-zone-edit-pending'){
      if(!zoneMoveStart)return;
      const dx=event.clientX-zoneMoveStart.clientX,dy=event.clientY-zoneMoveStart.clientY;
      if(Math.hypot(dx,dy)<5)return;
      pointerAction='wms-zone-move';
      event.currentTarget.classList.add('zone-moving');
    }
    if(pointerAction==='wms-zone-move'){
      const zone=zones.find(item=>item.id===zoneMoveId);if(!zone||!zoneMoveStart)return;
      const p=floorPoint(event),next=snapZonePosition(zone,zoneMoveStart.x+(p.x-zoneMoveStart.pointer.x),zoneMoveStart.y+(p.y-zoneMoveStart.pointer.y));
      const candidate={x:next.x,y:next.y,w:zone.w,h:zone.h};
      if(validZone(candidate,zone.id)){
        zone.x=next.x;zone.y=next.y;zoneMoveChanged=true;zoneEditDirty=true;
        const node=[...document.querySelectorAll('[data-zone-id]')].find(item=>item.dataset.zoneId===zone.id);
        if(node)node.setAttribute('transform',`translate(${zone.x-zoneMoveStart.x} ${zone.y-zoneMoveStart.y})`);
      }
      return;
    }
    if(pointerAction==='wms-zone-resize'){
      const zone=zones.find(item=>item.id===zoneMoveId);if(!zone||!zoneResizeStart)return;
      const base=zoneResizeStart.geometry,p=snapZonePoint(floorPoint(event),true,zone.id),minSize=20;
      const left=base.x,top=base.y,right=base.x+base.w,bottom=base.y+base.h;
      let next={...base};
      if(zoneResizeStart.handle.includes('w')){next.x=Math.min(p.x,right-minSize);next.w=right-next.x}
      if(zoneResizeStart.handle.includes('e')){next.w=Math.max(minSize,p.x-left)}
      if(zoneResizeStart.handle.includes('n')){next.y=Math.min(p.y,bottom-minSize);next.h=bottom-next.y}
      if(zoneResizeStart.handle.includes('s')){next.h=Math.max(minSize,p.y-top)}
      if(validZone(next,zone.id)){
        Object.assign(zone,next);zoneEditDirty=true;
        showZoneResizePreview(zone);
      }
      return;
    }
    return originalPointerMove(event)
  };
  window.onPointerUp=function(event){
    if(pointerAction==='wms-zone'){
      const rect={x:Math.min(zoneStart.x,zoneCurrent.x),y:Math.min(zoneStart.y,zoneCurrent.y),w:Math.abs(zoneCurrent.x-zoneStart.x),h:Math.abs(zoneCurrent.y-zoneStart.y)};
      pointerAction=null;zoneDraw=false;zoneStart=null;zoneCurrent=null;try{event.currentTarget.releasePointerCapture(event.pointerId)}catch(_){}
      if(!validZone(rect)){toast('Зона должна быть внутри склада, не пересекать другие зоны и иметь размер не менее 1×1 м.','warning');render();return}
      openZoneForm(null,rect);render();return;
    }
    if(pointerAction==='wms-zone-edit-pending'){
      const zone=zones.find(item=>item.id===zoneMoveId);
      pointerAction=null;try{event.currentTarget.releasePointerCapture(event.pointerId)}catch(_){}
      zoneMoveStart=null;zoneMoveChanged=false;
      // Handle the click here rather than waiting for the browser click event:
      // pointer capture/preventDefault can otherwise swallow that click.
      suppressZoneClickUntil=Date.now()+250;
      if(zone)openZoneActionMenu(zone,event);
      return;
    }
    if(pointerAction==='wms-zone-move'||pointerAction==='wms-zone-resize'){
      const changed=zoneEditDirty;
      pointerAction=null;event.currentTarget.classList.remove('zone-moving','zone-resizing');try{event.currentTarget.releasePointerCapture(event.pointerId)}catch(_){}
      clearZoneResizePreview();
      zoneMoveStart=null;zoneMoveChanged=false;zoneResizeStart=null;
      if(changed)suppressZoneClickUntil=Date.now()+250;
      render();
      return;
    }
    return originalPointerUp(event);
  };
  window.onFloorClick=function(event){
    if(Date.now()<suppressZoneClickUntil){event.preventDefault();event.stopPropagation();return}
    const boxNode=event.target.closest?.('[data-box-id]');if(boxNode){event.preventDefault();event.stopPropagation();openBox(boxNode.dataset.boxId);return}
    const zoneNode=event.target.closest?.('[data-zone-id]');if(zoneNode){event.preventDefault();event.stopPropagation();const zone=zones.find(item=>item.id===zoneNode.dataset.zoneId);if(zone)openZoneActionMenu(zone,event);return}
    return originalFloorClick(event);
  };
  window.bindWorkspace=function(){
    originalBindWorkspace();

    const canLayout=can('layout_manage'),canZones=can('zones_manage');
    ['new-warehouse','rename-warehouse','delete-warehouse','edit-copy','warehouse-size','clear-draft','to-objects','back-to-walls','save-design','change-layout'].forEach(id=>{
      const element=document.getElementById(id);if(element&&!canLayout){element.disabled=true;element.hidden=true}
    });
    if(!canLayout){
      document.querySelectorAll('[data-tool],[data-object-tool],[data-object-select]').forEach(element=>{element.disabled=true;element.hidden=true});
    }

    document.getElementById('wms-add-zone')?.addEventListener('click',()=>{
      if(!requireClientPermission('zones_manage','У вас нет доступа к созданию зон.'))return;
      if(zoneMoveId){toast('Сначала сохраните или отмените редактирование зоны.','warning');return}
      zoneDraw=!zoneDraw;closeZoneMenu();const button=document.getElementById('wms-add-zone');button.classList.toggle('primary',zoneDraw);button.textContent=zoneDraw?'Рисуйте зону · шаг 0,5 м':'+ Нарисовать зону';document.getElementById('floor')?.classList.toggle('zone-drawing',zoneDraw)
    });
    document.querySelectorAll('[data-open-zone]').forEach(button=>button.onclick=()=>{if(zoneMoveId){toast('Сначала сохраните или отмените редактирование зоны.','warning');return}openZoneForm(zones.find(zone=>zone.id===button.dataset.openZone))});
    document.querySelectorAll('[data-edit-zone]').forEach(button=>button.onclick=()=>{if(canZones)startZoneEdit(zones.find(zone=>zone.id===button.dataset.editZone))});
  };
  function openZoneForm(zone,rect){
    const value=zone||rect;
    const title=zone?'Зона хранения':'Новая зона';
    const zoneBoxes=zone?wms.boxes.filter(box=>box.warehouseId===activeWarehouseId()&&box.zoneId===zone.id):[];
    const boxesHtml=zone?`<div class="zone-box-panel"><div class="zone-box-panel-head"><span>Коробки в зоне</span><b>${zoneBoxes.length}</b></div><div class="zone-modal-boxes">${zoneBoxes.length?zoneBoxes.map(box=>`<div class="zone-modal-box"><button type="button" class="zone-modal-box-main" data-zone-box-open="${esc(box.id)}"><span><b>${esc(box.id)}</b><small>${boxQuantity(box)} ед. · ${box.locked?'заблокирована':'активна'}</small></span><span class="zone-modal-box-arrow">→</span></button><button type="button" class="zone-modal-box-delete" data-zone-box-delete="${esc(box.id)}" title="Удалить коробку">Удалить</button></div>`).join(''):'<div class="zone-modal-box-empty">В этой зоне пока нет коробок.</div>'}</div></div>`:'';
    openModal(title,`<form class="wms-form" id="zone-form"><label>Название<input name="name" value="${esc(zone?.name||`Зона ${zones.length+1}`)}" required></label><label>Вместимость, коробок<input name="capacity" type="number" min="0" value="${Number(zone?.capacity||0)}"><small>0 — без ограничения</small></label><div class="four-fields"><label>X, м<input name="x" type="number" min="0" step=".1" value="${(value.x*SCALE).toFixed(1)}"></label><label>Y, м<input name="y" type="number" min="0" step=".1" value="${(value.y*SCALE).toFixed(1)}"></label><label>Ширина, м<input name="w" type="number" min="1" step=".1" value="${(value.w*SCALE).toFixed(1)}"></label><label>Длина, м<input name="h" type="number" min="1" step=".1" value="${(value.h*SCALE).toFixed(1)}"></label></div>${zone?`<label class="check-row"><input name="locked" type="checkbox" ${zone.locked?'checked':''}> Заблокировать размещение</label>${boxesHtml}`:''}<div class="form-error"></div><div class="modal-actions">${zone?'<button type="button" class="btn" id="zone-add-box">+ Коробка</button><button type="button" class="btn danger-outline" id="zone-delete">Удалить зону</button>':''}<button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Сохранить</button></div></form>`,(modal,close)=>{
      modal.querySelector('#zone-add-box')?.addEventListener('click',()=>{if(zone.locked){toast('Зона заблокирована.','warning');return}close();openBoxForm(null,zone.id)});
      modal.querySelector('#zone-delete')?.addEventListener('click',()=>{const count=wms.boxes.filter(box=>box.warehouseId===activeWarehouseId()&&box.zoneId===zone.id).length;if(count){toast('Сначала переместите или удалите коробки из зоны.','warning');return}if(confirm(`Удалить зону «${zone.name}»?`)){zones.splice(zones.indexOf(zone),1);persist();close();render()}});
      modal.querySelectorAll('[data-zone-box-open]').forEach(button=>button.addEventListener('click',()=>{const boxId=button.dataset.zoneBoxOpen;close();openBox(boxId)}));
      modal.querySelectorAll('[data-zone-box-delete]').forEach(button=>button.addEventListener('click',()=>{
        const box=wms.boxes.find(item=>item.id===button.dataset.zoneBoxDelete);
        if(!box||!deleteBox(box))return;
        const zoneId=zone.id;
        close();
        render();
        requestAnimationFrame(()=>{const current=zones.find(item=>item.id===zoneId);if(current)openZoneForm(current)});
      }));
      modal.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),geometry={x:Number(data.x)/SCALE,y:Number(data.y)/SCALE,w:Number(data.w)/SCALE,h:Number(data.h)/SCALE};if(!validZone(geometry,zone?.id)){form.querySelector('.form-error').innerHTML='<div class="error">Зона выходит за границы склада или пересекает другую зону.</div>';return}if(zone)Object.assign(zone,geometry,{name:data.name.trim(),capacity:Number(data.capacity)||0,locked:form.elements.locked.checked});else zones.push({id:uid('ZONE'),...geometry,name:data.name.trim(),capacity:Number(data.capacity)||0,locked:false,createdAt:new Date().toISOString()});persist();saveWms(`${zone?'Изменена':'Создана'} зона ${data.name.trim()}`);close();render()};
    });
  }

  async function bootstrap(){
    await detectBackend();
    if(backendAvailable&&token()){
      try{const result=await requestApi('/api/auth/session');currentUser=result.user;sessionStorage.setItem(USER_KEY,JSON.stringify(currentUser));sessionStorage.setItem(AUTH_KEY,'admin');await pullState(true)}catch(_){sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(USER_KEY);sessionStorage.removeItem(AUTH_KEY);currentUser=null}
    }else if(!backendAvailable&&sessionStorage.getItem(AUTH_KEY)==='admin')currentUser=currentUser||{id:'local-admin',login:'Admin1',name:'Администратор',role:'admin'};
    else if(backendAvailable&&!token()){sessionStorage.removeItem(AUTH_KEY);currentUser=null}
    window.render();pollState();
    if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  window.addEventListener('online',async()=>{await detectBackend();if(backendAvailable){await pushState();pollState()}window.render()});
  window.addEventListener('offline',()=>{backendAvailable=false;updateConnectionBadge()});
  window.BFBS={get wms(){return wms},saveWms,uid,toast,openModal,activeWarehouseId,warehouseName,recordMovement,requestApi,get backendAvailable(){return backendAvailable},get currentUser(){return currentUser}};
  bootstrap();

  /* Operational sections and workspace extensions are declared below. */
  function googleSummaryUrl(){
    return `https://docs.google.com/spreadsheets/d/${GOOGLE_SUMMARY_SHEET_ID}/export?format=csv&gid=${GOOGLE_SUMMARY_GID}`;
  }
  function rowsToGoogleSummary(rows){
    const result=new Map();
    (rows||[]).forEach(row=>{
      const barcode=String(row?.[0]||'').replace(/\.0$/,'').trim();
      if(!/^\d{8,20}$/.test(barcode))return;
      const article=String(row?.[1]||'').trim(),size=String(row?.[4]||'').trim();
      const packed=Number(String(row?.[9]||'0').replace(/\s/g,'').replace(',','.'))||0;
      const key=[barcode,article,size].join('|');
      const existing=result.get(key)||{barcode,article,size,packed:0};
      existing.packed+=packed;result.set(key,existing);
    });
    return [...result.values()].sort((a,b)=>String(a.article).localeCompare(String(b.article),'ru')||String(a.size).localeCompare(String(b.size),'ru'));
  }
  async function loadGoogleSummary(force=false){
    if(sheetSummaryLoading||(!force&&sheetSummary.length&&Date.now()-sheetSummaryLoadedAt<60000)){renderGoogleSummary();return}
    sheetSummaryLoading=true;sheetSummaryError='';renderGoogleSummary();
    try{
      if(backendAvailable&&token()){
        const result=await requestApi('/api/google-sheet/summary');
        sheetSummary=result.items||[];
      }else{
        const response=await fetch(googleSummaryUrl(),{cache:'no-store'});
        if(!response.ok)throw new Error(`Google Sheets: ошибка ${response.status}`);
        sheetSummary=rowsToGoogleSummary(parseDelimited(await response.text()));
      }
      sheetSummaryLoadedAt=Date.now();
    }catch(error){
      sheetSummaryError=error.message||'Не удалось получить таблицу.';
      sheetSummary=[];
    }finally{
      sheetSummaryLoading=false;renderGoogleSummary();
    }
  }
  function renderGoogleSummary(){
    const host=document.getElementById('google-summary-body');if(!host)return;
    const query=(document.getElementById('google-summary-search')?.value||'').trim().toLowerCase();
    if(sheetSummaryLoading){host.innerHTML='<div class="sheet-feed-state">Обновляем «Сводную»…</div>';return}
    if(sheetSummaryError){host.innerHTML=`<div class="sheet-feed-state error-text">${esc(sheetSummaryError)}<small>Если таблица закрыта от публичного просмотра, трансляция заработает через сервер после предоставления ему доступа.</small></div>`;return}
    const items=sheetSummary.filter(item=>!query||[item.barcode,item.article,item.size].some(value=>String(value||'').toLowerCase().includes(query))).slice(0,200);
    if(!items.length){host.innerHTML='<div class="sheet-feed-state">Подходящих строк нет.</div>';return}
    host.innerHTML=`<div class="wms-table-wrap sheet-table-wrap"><table class="wms-table"><thead><tr><th>ШК · A</th><th>Артикул · B</th><th>Размер · E</th><th>Упаковано · J</th><th></th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.barcode)}</td><td><b>${esc(item.article)}</b></td><td>${esc(item.size)}</td><td><b>${Number(item.packed||0)}</b></td><td>${['admin','manager'].includes(currentUser?.role)&&Number(item.packed)>0?`<button type="button" class="table-link" data-sheet-transfer="${esc(item.barcode)}" data-sheet-qty="${Number(item.packed||0)}">Создать заявку</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
    host.querySelectorAll('[data-sheet-transfer]').forEach(button=>button.onclick=()=>openTransferForm({barcode:button.dataset.sheetTransfer,quantity:Number(button.dataset.sheetQty)||1,source:'google-sheet'}));
  }
  function transferView(){
    return `<section class="wms-page"><div class="wms-page-head"><div><h2>Заявки на перемещение</h2><p>Списание происходит только после «Отправить» и только из выбранной коробки-источника.</p></div>${['admin','manager'].includes(currentUser?.role)?'<button class="btn primary" id="add-transfer">+ Новая заявка</button>':''}</div><div class="wms-subsection sheet-feed"><div class="panel-head"><div><div class="panel-title">Сводная · Google Sheets</div><div class="sheet-feed-note">Трансляция A / B / E / J: ШК, артикул, размер и «Итого упаковано».</div></div><button type="button" class="btn" id="refresh-google-summary">Обновить</button></div><input id="google-summary-search" class="sheet-feed-search" placeholder="Поиск по ШК, артикулу или размеру"><div id="google-summary-body"><div class="sheet-feed-state">Загрузка…</div></div></div><div class="panel-title transfer-list-title">Заявки B-FBS</div><div id="transfers-list" class="operation-list"></div></section>`;
  }
  function renderTransfers(){
    const host=document.getElementById('transfers-list');if(!host)return;
    host.innerHTML=wms.transfers.length?wms.transfers.map(transfer=>`<article class="operation-card"><div><span class="status-pill ${transfer.status==='received'?'ok':''}">${esc(statusLabel(transfer.status))}</span><h3>${esc(transfer.article)} · ${esc(transfer.size)}</h3><p><b>Источник:</b> ${esc(warehouseName(transfer.fromWarehouseId))} · ${esc(transfer.boxId||'—')} → <b>Назначение:</b> ${esc(warehouseName(transfer.toWarehouseId))}</p><small>${esc(transfer.barcode)} · ${Number(transfer.quantity)} ед. · ${dateText(transfer.createdAt)}${transfer.source==='google-sheet'?' · из «Сводной»':''}</small></div><div class="operation-actions">${transfer.status==='new'?'<button class="btn" data-transfer-send="'+esc(transfer.id)+'">Отправить и списать</button>':''}${transfer.status==='in_transit'?'<button class="btn primary" data-transfer-receive="'+esc(transfer.id)+'">Принять</button>':''}${!['received','cancelled'].includes(transfer.status)?'<button class="btn danger-outline" data-transfer-cancel="'+esc(transfer.id)+'">Отменить</button>':''}</div></article>`).join(''):empty('Заявок на перемещение пока нет.');
    host.querySelectorAll('[data-transfer-send]').forEach(button=>button.onclick=()=>sendTransfer(button.dataset.transferSend));
    host.querySelectorAll('[data-transfer-receive]').forEach(button=>button.onclick=()=>receiveTransfer(button.dataset.transferReceive));
    host.querySelectorAll('[data-transfer-cancel]').forEach(button=>button.onclick=()=>cancelTransfer(button.dataset.transferCancel));
  }
  function bindTransfers(){
    if(document.getElementById('transfers-list')){renderTransfers();loadGoogleSummary(false)}
    document.getElementById('add-transfer')?.addEventListener('click',()=>openTransferForm());
    document.getElementById('refresh-google-summary')?.addEventListener('click',()=>loadGoogleSummary(true));
    document.getElementById('google-summary-search')?.addEventListener('input',renderGoogleSummary);
  }
  function openTransferForm(prefill={}){
    const sourceBoxes=wms.boxes.filter(box=>boxQuantity(box)>0&&(!prefill.barcode||(box.items||[]).some(item=>item.barcode===prefill.barcode&&Number(item.quantity)>0)));
    if(!sourceBoxes.length){toast(prefill.barcode?'В B-FBS нет коробки с остатком этого ШК. Сначала разместите товар на складе.':'Нет коробок с остатками для перемещения.','warning');return}
    const source=sourceBoxes[0],target=warehouses().find(item=>item.id!==source.warehouseId);
    if(!target){toast('Для перемещения создайте второй склад.','warning');return}
    const initialItem=(source.items||[]).find(item=>item.barcode===prefill.barcode&&Number(item.quantity)>0)||(source.items||[]).find(item=>Number(item.quantity)>0);
    const initialQty=Math.max(1,Math.min(Number(prefill.quantity)||1,Number(initialItem?.quantity)||1));
    openModal('Новая заявка',`<form class="wms-form" id="transfer-form"><div class="transfer-source-note">Списание произойдет при отправке заявки из выбранной ниже коробки.</div><label>Коробка-источник<select name="boxId">${sourceBoxes.map(box=>`<option value="${esc(box.id)}">${esc(box.id)} · ${esc(warehouseName(box.warehouseId))} · ${esc(findZone(box.warehouseId,box.zoneId)?.name||box.zoneId)} · ${boxQuantity(box)} ед.</option>`).join('')}</select></label><label>Товар<select name="barcode" id="transfer-sku"></select></label><label>Склад назначения<select name="toWarehouseId">${warehouseOptions(target.id,source.warehouseId)}</select></label><label>Количество<input name="quantity" type="number" min="1" value="${initialQty}" required></label><div class="form-error"></div><div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Создать заявку</button></div></form>`,(modal,close)=>{
      const form=modal.querySelector('form'),boxSelect=form.elements.boxId,skuSelect=form.elements.barcode,targetSelect=form.elements.toWarehouseId;
      const update=()=>{const box=wms.boxes.find(item=>item.id===boxSelect.value);skuSelect.innerHTML=(box?.items||[]).filter(item=>Number(item.quantity)>0).map(item=>`<option value="${esc(item.barcode)}">${esc(item.article)} · ${esc(item.size)} · ${Number(item.quantity)} ед.</option>`).join('');if(prefill.barcode&&[...skuSelect.options].some(option=>option.value===prefill.barcode))skuSelect.value=prefill.barcode;targetSelect.innerHTML=warehouseOptions('',box?.warehouseId);targetSelect.dispatchEvent(new Event('change',{bubbles:true}))};
      boxSelect.onchange=update;update();
      form.onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form)),box=wms.boxes.find(item=>item.id===data.boxId),item=box?.items.find(row=>row.barcode===data.barcode),quantity=Number(data.quantity);if(!item||quantity<1||quantity>Number(item.quantity)){form.querySelector('.form-error').innerHTML='<div class="error">Количество превышает остаток в выбранной коробке.</div>';return}const targetZones=warehouses().find(warehouse=>warehouse.id===data.toWarehouseId)?.zones||[];if(!targetZones.length){form.querySelector('.form-error').innerHTML='<div class="error">На складе назначения нет зон хранения.</div>';return}wms.transfers.unshift({id:uid('TR'),status:'new',boxId:box.id,fromWarehouseId:box.warehouseId,toWarehouseId:data.toWarehouseId,toZoneId:targetZones[0].id,article:item.article,barcode:item.barcode,size:item.size,quantity,source:prefill.source||'manual',createdAt:new Date().toISOString(),createdBy:currentUser?.name||''});saveWms(`Создана заявка на перемещение ${item.article}`);close();renderTransfers()};
    });
  }
  function sendTransfer(id){const transfer=wms.transfers.find(item=>item.id===id),box=wms.boxes.find(item=>item.id===transfer?.boxId),stock=box?.items.find(item=>item.barcode===transfer?.barcode);if(!transfer||transfer.status!=='new'||!stock)return;if(Number(stock.quantity)<transfer.quantity){toast('Остатка в исходной коробке уже недостаточно.','warning');return}stock.quantity-=transfer.quantity;box.updatedAt=new Date().toISOString();transfer.status='in_transit';transfer.sentAt=new Date().toISOString();recordMovement('transfer_out',-transfer.quantity,box,stock,transfer.id);saveWms(`Отправлено перемещение ${transfer.id}: списано ${transfer.quantity} ед. из ${box.id}`);renderTransfers()}
  function receiveTransfer(id){const transfer=wms.transfers.find(item=>item.id===id);if(!transfer||transfer.status!=='in_transit')return;let box=wms.boxes.find(item=>item.warehouseId===transfer.toWarehouseId&&item.zoneId===transfer.toZoneId&&!item.locked);if(!box){box={id:nextBoxId(),qrCode:'',warehouseId:transfer.toWarehouseId,zoneId:transfer.toZoneId,items:[],locked:false,createdAt:new Date().toISOString()};box.qrCode=`BFBS:BOX:${box.id}`;wms.boxes.push(box)}const item=upsertBoxItem(box,transfer,transfer.quantity);transfer.status='received';transfer.receivedAt=new Date().toISOString();transfer.receivedBoxId=box.id;recordMovement('transfer_in',transfer.quantity,box,item,transfer.id);saveWms(`Получено перемещение ${transfer.id}`);renderTransfers()}
  function cancelTransfer(id){const transfer=wms.transfers.find(item=>item.id===id);if(!transfer||['received','cancelled'].includes(transfer.status))return;if(transfer.status==='in_transit'){const box=wms.boxes.find(item=>item.id===transfer.boxId);if(box){const stock=upsertBoxItem(box,transfer,transfer.quantity);recordMovement('transfer_return',transfer.quantity,box,stock,transfer.id)}}transfer.status='cancelled';transfer.cancelledAt=new Date().toISOString();saveWms(`Отменено перемещение ${transfer.id}`);renderTransfers()}

  function revisionView(){return `<section class="wms-page"><div class="wms-page-head"><div><h2>Ревизия</h2><p>Приоритет рассчитывается по низкому остатку, давности и движениям.</p></div>${['admin','manager','auditor'].includes(currentUser?.role)?'<button class="btn primary" id="generate-revisions">Сформировать задания</button>':''}</div><div id="revisions-list" class="operation-list"></div></section>`}
  function revisionScore(box){const age=Math.min(30,Math.floor((Date.now()-new Date(box.updatedAt||box.createdAt||0).getTime())/86400000)),moves=wms.movements.filter(item=>item.boxId===box.id).length,low=boxQuantity(box)<=3?40:0;return low+Math.min(30,moves*3)+Math.min(30,Math.max(0,age))}
  function renderRevisions(){const host=document.getElementById('revisions-list');if(!host)return;host.innerHTML=wms.revisions.length?wms.revisions.map(item=>`<article class="operation-card"><div><span class="priority ${item.priority==='Высокий'?'high':''}">${esc(item.priority)} приоритет</span><h3>${esc(item.boxId)}</h3><p>${esc(warehouseName(item.warehouseId))} · ${esc(findZone(item.warehouseId,item.zoneId)?.name||item.zoneId)}</p><small>${statusLabel(item.status)} · создано ${dateText(item.createdAt)}${item.completedAt?' · проверено '+dateText(item.completedAt):''}</small></div><div class="operation-actions">${item.status!=='done'?'<button class="btn primary" data-revision-check="'+esc(item.id)+'">Проверить</button>':''}</div></article>`).join(''):empty('Активных заданий на ревизию нет.');host.querySelectorAll('[data-revision-check]').forEach(button=>button.onclick=()=>openRevision(button.dataset.revisionCheck))}
  function bindRevisions(){if(document.getElementById('revisions-list'))renderRevisions();document.getElementById('generate-revisions')?.addEventListener('click',()=>{let added=0;wms.boxes.slice().sort((a,b)=>revisionScore(b)-revisionScore(a)).slice(0,20).forEach(box=>{if(wms.revisions.some(item=>item.boxId===box.id&&item.status!=='done'))return;const score=revisionScore(box);wms.revisions.push({id:uid('REV'),boxId:box.id,warehouseId:box.warehouseId,zoneId:box.zoneId,status:'queued',score,priority:score>=50?'Высокий':score>=25?'Средний':'Обычный',createdAt:new Date().toISOString()});added++});saveWms(`Сформировано заданий ревизии: ${added}`);toast(`Создано заданий: ${added}`,'success');renderRevisions()})}
  function openRevision(id){const revision=wms.revisions.find(item=>item.id===id),box=wms.boxes.find(item=>item.id===revision?.boxId);if(!revision||!box)return;openModal(`Ревизия ${box.id}`,`<form class="wms-form" id="revision-form"><label>QR коробки<input name="qrCode" autocomplete="off" placeholder="${esc(box.qrCode)}" required></label><p>После подтверждения коробки укажите фактическое количество.</p>${(box.items||[]).map((item,index)=>`<label>${esc(item.article)} · ${esc(item.size)} · ${esc(item.barcode)}<input name="qty-${index}" type="number" min="0" value="${Number(item.quantity||0)}"></label>`).join('')||empty('Коробка пуста')}<label>Комментарий<textarea name="note" rows="3"></textarea></label><div class="form-error"></div><div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Завершить проверку</button></div></form>`,(modal,close)=>{modal.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;if(![box.id,box.qrCode].includes(form.elements.qrCode.value.trim())){form.querySelector('.form-error').innerHTML='<div class="error">QR-код не соответствует коробке задания.</div>';return}(box.items||[]).forEach((item,index)=>{const actual=Math.max(0,Number(form.elements[`qty-${index}`].value)||0),difference=actual-Number(item.quantity||0);if(difference)recordMovement('revision_adjustment',difference,box,item,form.elements.note.value);item.quantity=actual});box.updatedAt=new Date().toISOString();revision.status='done';revision.completedAt=new Date().toISOString();revision.completedBy=currentUser?.name||'';revision.note=form.elements.note.value;saveWms(`Завершена ревизия ${box.id}`);close();renderRevisions()}})}

  function tasksView(){
    const canCreate=['admin','manager'].includes(currentUser?.role);
    const active=wms.tasks.filter(task=>!['ready','done','cancelled'].includes(task.status)).length;
    return `<section class="wms-page">
      <div class="wms-page-head">
        <div><h2>Сборочные задания</h2><p>Сначала QR коробки, затем штрихкод товара. Для сборщиков доступен отдельный Scanner Mode.</p></div>
        <div class="wms-actions">
          <button class="btn scanner-launch" id="scanner-mode" ${active?'':'disabled'}>Scanner Mode${active?` · ${active}`:''}</button>
          ${canCreate?'<button class="btn primary" id="add-task">+ Создать задание</button>':''}
        </div>
      </div>
      <div id="tasks-list" class="operation-list"></div>
    </section>`;
  }
  function taskProgress(task){const required=(task.lines||[]).reduce((sum,line)=>sum+Number(line.required||0),0),picked=(task.lines||[]).reduce((sum,line)=>sum+Number(line.picked||0),0);return {required,picked}}
  function renderTasks(){
    const host=document.getElementById('tasks-list');if(!host)return;
    host.innerHTML=wms.tasks.length?wms.tasks.map(task=>{
      const progress=taskProgress(task),line=task.lines?.[0]||{},percent=progress.required?Math.min(100,Math.round(progress.picked/progress.required*100)):0;
      return `<article class="operation-card">
        <div>
          <span class="status-pill ${task.status==='ready'||task.status==='done'?'ok':''}">${esc(statusLabel(task.status))}</span>
          <h3>${esc(task.number||task.id)}</h3>
          <p>${esc(line.article||'')} · ${esc(line.size||'')} · ${progress.picked}/${progress.required} ед.</p>
          <small>${esc(line.barcode||'')} · ${dateText(task.createdAt)}</small>
          <div class="task-progress-mini"><span style="width:${percent}%"></span></div>
        </div>
        <div class="operation-actions">
          ${!['ready','done','cancelled'].includes(task.status)?'<button class="btn primary" data-task-work="'+esc(task.id)+'">Собирать</button>':''}
          ${task.status==='ready'?'<button class="btn primary" data-task-done="'+esc(task.id)+'">Завершить</button>':''}
        </div>
      </article>`;
    }).join(''):empty('Сборочных заданий пока нет.');
    host.querySelectorAll('[data-task-work]').forEach(button=>button.onclick=()=>openTaskScanner(button.dataset.taskWork));
    host.querySelectorAll('[data-task-done]').forEach(button=>button.onclick=()=>{
      const task=wms.tasks.find(item=>item.id===button.dataset.taskDone);if(!task)return;
      task.status='done';task.completedAt=new Date().toISOString();
      saveWms(`Завершено задание ${task.number}`);renderTasks();
    });
  }
  function bindTasks(){
    if(document.getElementById('tasks-list'))renderTasks();
    document.getElementById('add-task')?.addEventListener('click',openTaskForm);
    document.getElementById('scanner-mode')?.addEventListener('click',openScannerTaskChoice);
  }
  function openScannerTaskChoice(){
    const active=wms.tasks.filter(task=>!['ready','done','cancelled'].includes(task.status));
    if(!active.length){toast('Нет заданий, доступных для сборки.','info');return}
    if(active.length===1){openTaskScanner(active[0].id);return}
    openModal('Scanner Mode',`<div class="scanner-task-choice">
      <p>Выберите задание. После открытия интерфейс переключится в крупный режим для сканера.</p>
      <div class="scanner-task-list">${active.map(task=>{
        const p=taskProgress(task),line=task.lines?.[0]||{};
        return `<button type="button" data-scanner-task="${esc(task.id)}"><span><b>${esc(task.number||task.id)}</b><small>${esc(line.article||'')} · ${esc(line.size||'')}</small></span><strong>${p.picked}/${p.required}</strong></button>`;
      }).join('')}</div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button></div>
    </div>`,(modal,close)=>{
      modal.querySelectorAll('[data-scanner-task]').forEach(button=>button.onclick=()=>{const id=button.dataset.scannerTask;close();openTaskScanner(id)});
    });
  }
  function openTaskForm(){if(!wms.nomenclature.length){toast('Сначала загрузите номенклатуру.','warning');return}openModal('Новое сборочное задание',`<form class="wms-form" id="task-form"><label>Товар<select name="barcode">${skuOptions()}</select></label><label>Количество<input name="quantity" type="number" min="1" value="1" required></label><label>Номер заказа / поставки<input name="number" value="${esc(`FBS-${Date.now().toString().slice(-6)}`)}"></label><div class="form-error"></div><div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Создать</button></div></form>`,(modal,close)=>{modal.querySelector('form').onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget)),sku=itemByBarcode(data.barcode),quantity=Number(data.quantity),stock=wms.boxes.reduce((sum,box)=>sum+Number(box.items.find(item=>item.barcode===data.barcode)?.quantity||0),0);if(!sku||quantity<1||quantity>stock){event.currentTarget.querySelector('.form-error').innerHTML=`<div class="error">Доступный остаток: ${stock} ед.</div>`;return}wms.tasks.unshift({id:uid('TASK'),number:data.number.trim(),status:'queued',lines:[{article:sku.article,barcode:sku.barcode,size:sku.size,required:quantity,picked:0}],createdAt:new Date().toISOString(),createdBy:currentUser?.name||''});saveWms(`Создано сборочное задание ${data.number}`);close();renderTasks()}})}
  function suggestedBoxes(barcode){return wms.boxes.filter(box=>!box.locked&&Number(box.items.find(item=>item.barcode===barcode)?.quantity||0)>0).sort((a,b)=>Number(a.items.find(item=>item.barcode===barcode)?.quantity||0)-Number(b.items.find(item=>item.barcode===barcode)?.quantity||0))}
  function scannerBeep(kind='ok'){
    try{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
      const ctx=new AudioCtx(),osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type='sine';osc.frequency.value=kind==='error'?180:kind==='warn'?330:kind==='done'?720:520;
      gain.gain.setValueAtTime(.0001,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.08,ctx.currentTime+.01);
      gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+(kind==='done' ? .24 : .12));
      osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+(kind==='done' ? .25 : .13));
      osc.onended=()=>ctx.close().catch(()=>{});
    }catch(_){}
  }
  function openTaskScanner(id){
    const task=wms.tasks.find(item=>item.id===id),line=task?.lines?.[0];
    if(!task||!line)return;
    if(['ready','done','cancelled'].includes(task.status)){toast('Это задание уже недоступно для сборки.','warning');return}

    task.status='working';task.startedAt=task.startedAt||new Date().toISOString();saveWms();

    const node=document.createElement('section');
    node.className='scanner-screen';
    node.innerHTML=`<header class="scanner-top">
      <div><span>SCANNER MODE</span><h2>${esc(task.number||task.id)}</h2></div>
      <button type="button" class="scanner-close" aria-label="Закрыть">×</button>
    </header>
    <main class="scanner-main">
      <div class="scanner-product">
        <div><span>Товар</span><b>${esc(line.article)}</b><small>Размер ${esc(line.size)} · ШК ${esc(line.barcode)}</small></div>
        <div class="scanner-counter"><strong id="scanner-picked">${Number(line.picked||0)}</strong><span>/ ${Number(line.required||0)}</span></div>
      </div>
      <div class="scanner-progress"><span id="scanner-progress-bar"></span></div>

      <div class="scanner-state waiting" id="scanner-state">
        <div class="scanner-state-icon" id="scanner-state-icon">□</div>
        <div><span id="scanner-state-label">ШАГ 1</span><h3 id="scanner-state-title">Отсканируйте QR коробки</h3><p id="scanner-state-note">Система проверит, что в коробке есть нужный товар.</p></div>
      </div>

      <div class="scanner-active-box" id="scanner-active-box" hidden></div>

      <label class="scanner-input-wrap">
        <span>Сканер / ручной ввод</span>
        <input id="task-scan" autocomplete="off" inputmode="text" placeholder="QR коробки">
      </label>

      <div class="scanner-route-block">
        <div class="scanner-route-head"><b>Подходящие коробки</b><small>Остаток обновляется после каждого скана</small></div>
        <div class="scanner-route" id="scanner-route"></div>
      </div>
    </main>
    <footer class="scanner-footer"><span>Enter — принять скан · Esc — выйти</span><button type="button" class="btn" id="scanner-refocus">Вернуть фокус сканеру</button></footer>`;

    document.body.appendChild(node);document.body.classList.add('scanner-mode-active');

    let activeBox=null,finished=false;
    const input=node.querySelector('#task-scan'),state=node.querySelector('#scanner-state'),stateIcon=node.querySelector('#scanner-state-icon'),
      stateLabel=node.querySelector('#scanner-state-label'),stateTitle=node.querySelector('#scanner-state-title'),stateNote=node.querySelector('#scanner-state-note'),
      activeBoxHost=node.querySelector('#scanner-active-box'),pickedHost=node.querySelector('#scanner-picked'),progressBar=node.querySelector('#scanner-progress-bar'),
      routeHost=node.querySelector('#scanner-route');

    const progress=()=>{
      const picked=Number(line.picked||0),required=Math.max(1,Number(line.required||0));
      pickedHost.textContent=picked;progressBar.style.width=`${Math.min(100,picked/required*100)}%`;
    };
    const renderRoute=()=>{
      const boxes=suggestedBoxes(line.barcode);
      routeHost.innerHTML=boxes.length?boxes.map(box=>{
        const qty=Number(box.items.find(item=>item.barcode===line.barcode)?.quantity||0);
        return `<div class="scanner-route-item ${activeBox?.id===box.id?'active':''}"><span>${esc(findZone(box.warehouseId,box.zoneId)?.name||box.zoneId||'Зона')}</span><b>${esc(box.id)}</b><strong>${qty} ед.</strong></div>`;
      }).join(''):'<div class="scanner-route-empty">Подходящих коробок с остатком больше нет.</div>';
    };
    const setState=(kind,title,note,label='СКАНЕР')=>{
      state.className=`scanner-state ${kind}`;
      stateIcon.textContent=kind==='success'?'✓':kind==='error'?'!':kind==='warning'?'↺':kind==='done'?'✓':'□';
      stateLabel.textContent=label;stateTitle.textContent=title;stateNote.textContent=note||'';
    };
    const showBox=()=>{
      if(!activeBox){activeBoxHost.hidden=true;activeBoxHost.innerHTML='';return}
      const stock=activeBox.items.find(item=>item.barcode===line.barcode),zone=findZone(activeBox.warehouseId,activeBox.zoneId);
      activeBoxHost.hidden=false;
      activeBoxHost.innerHTML=`<div><span>Активная коробка</span><b>${esc(activeBox.id)}</b><small>${esc(warehouseName(activeBox.warehouseId))} · ${esc(zone?.name||activeBox.zoneId)}</small></div><strong>${Number(stock?.quantity||0)} ед.</strong>`;
    };
    const refocus=()=>{if(!finished){input.focus();input.select?.()}};
    const close=()=>{
      node.remove();document.body.classList.remove('scanner-mode-active');document.removeEventListener('keydown',escapeHandler,true);
      renderTasks();
    };
    const acceptBox=candidate=>{
      const stock=candidate?.items?.find(item=>item.barcode===line.barcode);
      if(!candidate||candidate.locked||findZone(candidate.warehouseId,candidate.zoneId)?.locked||!stock||Number(stock.quantity)<=0)return false;
      activeBox=candidate;showBox();renderRoute();
      setState('success',`Коробка ${candidate.id} подтверждена`,`Теперь сканируйте ШК товара ${line.barcode}.`,'ШАГ 2');
      input.placeholder='Штрихкод товара';scannerBeep('ok');return true;
    };
    const finishTask=()=>{
      finished=true;task.status='ready';task.readyAt=new Date().toISOString();
      saveWms(`Задание ${task.number} собрано`);
      progress();showBox();renderRoute();
      setState('done','Задание собрано','Нужное количество подтверждено. Задание готово к отгрузке.','ГОТОВО');
      input.disabled=true;node.classList.add('scanner-complete');scannerBeep('done');
    };
    const scan=()=>{
      const value=input.value.trim();input.value='';if(!value||finished)return;
      const currentProgress=taskProgress(task);
      if(currentProgress.picked>=currentProgress.required){finishTask();return}

      if(!activeBox){
        if(value===line.barcode){
          setState('warning','Сначала нужна коробка','Отсканируйте QR коробки, из которой берете товар.','НЕВЕРНЫЙ ПОРЯДОК');
          scannerBeep('warn');refocus();return;
        }
        const candidate=boxByQr(value);
        if(!candidate){
          setState('error','QR коробки не распознан','Проверьте код и повторите сканирование.','ОШИБКА');
          scannerBeep('error');refocus();return;
        }
        if(!acceptBox(candidate)){
          setState('error','В этой коробке нет нужного товара','Выберите коробку из списка подходящих ниже.','НЕВЕРНАЯ КОРОБКА');
          scannerBeep('error');refocus();return;
        }
        refocus();return;
      }

      const scannedBox=boxByQr(value);
      if(scannedBox){
        if(acceptBox(scannedBox)){refocus();return}
        setState('error','Эта коробка не подходит','В ней нет доступного остатка нужного ШК.','НЕВЕРНАЯ КОРОБКА');
        scannerBeep('error');refocus();return;
      }

      if(value!==line.barcode){
        const otherSku=itemByBarcode(value);
        setState('error','Неверный товар',otherSku?`${otherSku.article} · размер ${otherSku.size} не входит в текущую строку задания.`:'Штрихкод не соответствует текущему заданию.','ОШИБКА');
        scannerBeep('error');refocus();return;
      }

      const stock=activeBox.items.find(item=>item.barcode===line.barcode);
      if(!stock||Number(stock.quantity)<=0){
        activeBox=null;showBox();renderRoute();
        setState('warning','Коробка закончилась','Отсканируйте QR следующей коробки.','СМЕНА КОРОБКИ');
        input.placeholder='QR коробки';scannerBeep('warn');refocus();return;
      }

      stock.quantity-=1;line.picked=Number(line.picked||0)+1;activeBox.updatedAt=new Date().toISOString();
      recordMovement('picking',-1,activeBox,stock,task.number);
      progress();showBox();renderRoute();

      if(Number(line.picked)>=Number(line.required)){finishTask();return}

      saveWms();
      if(Number(stock.quantity)<=0){
        activeBox=null;showBox();
        setState('warning',`Принято · ${line.picked}/${line.required}`,'Коробка закончилась. Отсканируйте следующую коробку.','ПРИНЯТО');
        input.placeholder='QR коробки';scannerBeep('ok');
      }else{
        setState('success',`Принято · ${line.picked}/${line.required}`,'Продолжайте сканировать этот товар.','ПРИНЯТО');
        scannerBeep('ok');
      }
      refocus();
    };
    const escapeHandler=event=>{if(event.key==='Escape'){event.preventDefault();close()}};

    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();scan()}});
    node.querySelector('.scanner-close').onclick=close;
    node.querySelector('#scanner-refocus').onclick=refocus;
    node.addEventListener('pointerdown',event=>{if(!event.target.closest('button,input'))setTimeout(refocus,0)});
    document.addEventListener('keydown',escapeHandler,true);

    progress();renderRoute();refocus();
  }

  function nextBoxId(){let max=0;wms.boxes.forEach(box=>{const match=String(box.id).match(/BOX-(\d+)/);if(match)max=Math.max(max,Number(match[1]))});return `BOX-${String(max+1).padStart(4,'0')}`}
  function openBoxForm(box,defaultZoneId){
    if(!wms.nomenclature.length){toast('Сначала добавьте или импортируйте номенклатуру.','warning');return}
    const warehouseId=box?.warehouseId||activeWarehouseId(),zoneId=box?.zoneId||defaultZoneId||((warehouseId===activeWarehouseId()?zones:warehouses().find(item=>item.id===warehouseId)?.zones)||[])[0]?.id;
    if(!zoneId){toast('Сначала создайте зону хранения.','warning');return}

    const selectedBarcode=box?.items?.[0]?.barcode||'';
    const selectedSku=itemByBarcode(selectedBarcode);
    const selectedArticle=selectedSku?.article||'';
    const selectedSize=selectedSku?.size||'';

    openModal(box?'Изменить коробку':'Новая коробка',`<form class="wms-form" id="box-form">
      <label>ID коробки<input name="id" value="${esc(box?.id||nextBoxId())}" ${box?'readonly':''} required></label>
      <label>Зона<select name="zoneId">${zoneOptions(warehouseId,zoneId)}</select></label>

      <div class="barcode-scan-block">
        <div class="barcode-scan-head"><div><b>Сканирование ШК</b><small>Отсканируйте товар — артикул, размер и ШК заполнятся автоматически.</small></div><span class="scan-indicator" id="box-scan-indicator">Готов к сканированию</span></div>
        <input id="box-barcode-scan" inputmode="numeric" autocomplete="off" placeholder="Отсканируйте или введите ШК товара" value="${esc(selectedBarcode)}">
        <div class="scan-result" id="box-scan-result">${selectedBarcode?esc((selectedSku?.article||'')+' · '+(selectedSku?.size||'')):'После успешного сканирования товар выберется автоматически.'}</div>
      </div>

      <div class="manual-sku-picker">
        <div class="manual-sku-head"><b>Ручной подбор</b><small>Найдите уникальный артикул, затем выберите размер — ШК подставится из номенклатуры.</small></div>
        <label>Артикул
          <div class="article-search">
            <input id="box-article-search" autocomplete="off" placeholder="Например: 210_К" value="${esc(selectedArticle)}">
            <div id="box-article-results" class="article-search-results" hidden></div>
          </div>
        </label>
        <label>Размер
          <select id="box-size-select" ${selectedArticle?'':'disabled'}><option value="">Сначала выберите артикул</option></select>
        </label>
        <input type="hidden" name="barcode" value="${esc(selectedBarcode)}">
        <div class="resolved-barcode" id="box-resolved-barcode">
          <span>ШК</span>
          <b>${selectedBarcode?esc(selectedBarcode):'—'}</b>
        </div>
      </div>

      <label>${box?'Добавить к остатку':'Начальное количество'}<input name="quantity" type="number" min="0" value="${box?0:1}"></label>
      ${box?`<label class="check-row"><input name="locked" type="checkbox" ${box.locked?'checked':''}> Заблокировать операции</label>`:''}
      <div class="form-error"></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>`,(modal,close)=>{
      const form=modal.querySelector('form');
      const scanInput=modal.querySelector('#box-barcode-scan');
      const scanResult=modal.querySelector('#box-scan-result');
      const scanIndicator=modal.querySelector('#box-scan-indicator');
      const articleInput=modal.querySelector('#box-article-search');
      const articleResults=modal.querySelector('#box-article-results');
      const sizeSelect=modal.querySelector('#box-size-select');
      const barcodeInput=form.elements.barcode;
      const barcodeView=modal.querySelector('#box-resolved-barcode b');
      const quantityInput=form.elements.quantity;

      const uniqueArticles=[...new Set(wms.nomenclature.map(item=>String(item.article||'').trim()).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b,'ru',{numeric:true,sensitivity:'base'}));

      const articleItems=article=>wms.nomenclature
        .filter(item=>item.article===article)
        .slice()
        .sort((a,b)=>String(a.size).localeCompare(String(b.size),'ru',{numeric:true,sensitivity:'base'}));

      let selectedArticleValue='';

      const syncBarcodeView=sku=>{
        barcodeInput.value=sku?.barcode||'';
        barcodeView.textContent=sku?.barcode||'—';
      };

      const selectSize=(size,{notify=false}={})=>{
        const items=articleItems(selectedArticleValue);
        const sku=items.find(item=>String(item.size)===String(size));
        if(!sku){syncBarcodeView(null);return null}
        sizeSelect.value=String(sku.size);
        sizeSelect.dispatchEvent(new Event('change',{bubbles:true}));
        syncBarcodeView(sku);
        scanInput.value=sku.barcode;
        scanIndicator.textContent='Выбрано вручную';
        scanIndicator.className='scan-indicator success';
        scanResult.innerHTML=`<b>${esc(sku.article)}</b><span>Размер ${esc(sku.size)} · ШК ${esc(sku.barcode)}</span>`;
        if(notify)toast(`Выбрано: ${sku.article} · ${sku.size}`,'success');
        return sku;
      };

      const selectArticle=(article,{preferredSize='',preferredBarcode='',focusSize=true}={})=>{
        const value=String(article||'').trim();
        const items=articleItems(value);
        if(!items.length)return false;

        selectedArticleValue=value;
        articleInput.value=value;
        articleResults.hidden=true;
        articleResults.innerHTML='';

        sizeSelect.disabled=false;
        const uniqueSizes=[...new Set(items.map(item=>String(item.size)))];
        sizeSelect.innerHTML=uniqueSizes.map(size=>`<option value="${esc(size)}">${esc(size)}</option>`).join('');

        let target=items.find(item=>preferredBarcode&&item.barcode===preferredBarcode)
          ||items.find(item=>preferredSize&&String(item.size)===String(preferredSize))
          ||items[0];

        sizeSelect.value=String(target.size);
        sizeSelect.dispatchEvent(new Event('change',{bubbles:true}));
        syncBarcodeView(target);

        if(focusSize)requestAnimationFrame(()=>sizeSelect.nextElementSibling?.querySelector('.ui-select-trigger')?.focus());
        return true;
      };

      const renderArticleResults=()=>{
        const query=articleInput.value.trim().toLowerCase();
        if(!query){
          articleResults.hidden=true;
          articleResults.innerHTML='';
          return;
        }

        const matches=uniqueArticles.filter(article=>article.toLowerCase().includes(query)).slice(0,30);
        articleResults.innerHTML=matches.length
          ?matches.map(article=>{
            const items=articleItems(article),sizes=[...new Set(items.map(item=>String(item.size)))];
            return `<button type="button" class="article-search-item" data-article="${esc(article)}"><span><b>${esc(article)}</b><small>${sizes.length} размеров · ${esc(sizes.slice(0,8).join(', '))}${sizes.length>8?'…':''}</small></span><span>Выбрать</span></button>`;
          }).join('')
          :'<div class="article-search-empty">Совпадений не найдено</div>';

        articleResults.hidden=false;
        articleResults.querySelectorAll('[data-article]').forEach(button=>button.addEventListener('click',()=>{
          selectArticle(button.dataset.article);
        }));
      };

      articleInput.addEventListener('input',()=>{
        const current=articleInput.value.trim();
        if(current!==selectedArticleValue){
          selectedArticleValue='';
          sizeSelect.disabled=true;
          sizeSelect.innerHTML='<option value="">Сначала выберите артикул</option>';
          sizeSelect.dispatchEvent(new Event('change',{bubbles:true}));
          syncBarcodeView(null);
        }
        renderArticleResults();
      });
      articleInput.addEventListener('focus',renderArticleResults);
      articleInput.addEventListener('keydown',event=>{
        if(event.key==='Escape'){articleResults.hidden=true;return}
        if(event.key!=='Enter')return;
        event.preventDefault();
        const exact=uniqueArticles.find(article=>article.toLowerCase()===articleInput.value.trim().toLowerCase());
        const first=articleResults.querySelector('[data-article]')?.dataset.article;
        if(exact||first)selectArticle(exact||first);
      });
      articleResults.addEventListener('mousedown',event=>event.preventDefault());
      articleInput.addEventListener('blur',()=>setTimeout(()=>{articleResults.hidden=true},120));

      sizeSelect.addEventListener('change',()=>{
        if(!selectedArticleValue)return;
        const sku=articleItems(selectedArticleValue).find(item=>String(item.size)===String(sizeSelect.value));
        if(!sku){syncBarcodeView(null);return}
        syncBarcodeView(sku);
        scanInput.value=sku.barcode;
        scanIndicator.textContent='Выбрано вручную';
        scanIndicator.className='scan-indicator success';
        scanResult.innerHTML=`<b>${esc(sku.article)}</b><span>Размер ${esc(sku.size)} · ШК ${esc(sku.barcode)}</span>`;
      });

      const recognizeBarcode=(raw,{notify=false}={})=>{
        const value=String(raw||'').trim();
        if(!value){
          scanIndicator.textContent='Готов к сканированию';
          scanIndicator.className='scan-indicator';
          scanResult.textContent='После успешного сканирования товар выберется автоматически.';
          return null;
        }
        const sku=itemByBarcode(value);
        if(!sku){
          scanIndicator.textContent='ШК не найден';
          scanIndicator.className='scan-indicator error';
          scanResult.textContent=`В номенклатуре нет ШК ${value}`;
          if(notify)toast('Штрихкод не найден в номенклатуре.','warning');
          return null;
        }

        selectArticle(sku.article,{preferredSize:sku.size,preferredBarcode:sku.barcode,focusSize:false});
        selectSize(sku.size);
        scanInput.value=sku.barcode;
        scanIndicator.textContent='Распознано';
        scanIndicator.className='scan-indicator success';
        scanResult.innerHTML=`<b>${esc(sku.article)}</b><span>Размер ${esc(sku.size)} · ШК ${esc(sku.barcode)}</span>`;
        if(notify)toast(`Распознано: ${sku.article} · ${sku.size}`,'success');
        return sku;
      };

      let scanTimer=0;
      scanInput.addEventListener('input',()=>{
        clearTimeout(scanTimer);
        const value=scanInput.value.trim();
        if(!value){recognizeBarcode('');return}
        scanTimer=setTimeout(()=>{
          const sku=recognizeBarcode(value);
          if(sku)quantityInput?.focus();
        },90);
      });
      scanInput.addEventListener('keydown',event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        clearTimeout(scanTimer);
        const sku=recognizeBarcode(scanInput.value,{notify:true});
        if(sku){
          quantityInput?.focus();
          quantityInput?.select?.();
        }else{
          scanInput.select();
        }
      });

      if(selectedSku){
        selectArticle(selectedSku.article,{preferredSize:selectedSku.size,preferredBarcode:selectedSku.barcode,focusSize:false});
        selectSize(selectedSku.size);
      }

      requestAnimationFrame(()=>{scanInput.focus();scanInput.select()});

      form.onsubmit=event=>{
        event.preventDefault();
        const data=Object.fromEntries(new FormData(form)),zone=findZone(warehouseId,data.zoneId),count=wms.boxes.filter(item=>item.warehouseId===warehouseId&&item.zoneId===data.zoneId&&item.id!==box?.id).length;
        if(zone?.locked){form.querySelector('.form-error').innerHTML='<div class="error">Зона заблокирована.</div>';return}
        if(zone?.capacity&&count>=Number(zone.capacity)){form.querySelector('.form-error').innerHTML='<div class="error">Вместимость зоны исчерпана.</div>';return}
        if(!box&&wms.boxes.some(item=>item.id.toLowerCase()===data.id.trim().toLowerCase())){form.querySelector('.form-error').innerHTML='<div class="error">Такой ID коробки уже существует.</div>';return}
        const sku=itemByBarcode(data.barcode);
        if(!sku){form.querySelector('.form-error').innerHTML='<div class="error">Отсканируйте товар или выберите артикул и размер.</div>';return}

        const quantity=Math.max(0,Number(data.quantity)||0),target=box||{id:data.id.trim(),qrCode:`BFBS:BOX:${data.id.trim()}`,warehouseId,items:[],createdAt:new Date().toISOString(),locked:false};
        target.zoneId=data.zoneId;target.locked=box?form.elements.locked.checked:false;
        if(quantity){const item=upsertBoxItem(target,sku,quantity);recordMovement(box?'replenishment':'initial_stock',quantity,target,item)}
        target.updatedAt=new Date().toISOString();if(!box)wms.boxes.push(target);
        saveWms(`${box?'Изменена':'Создана'} коробка ${target.id}`);close();render();
      };
    });
  }
  function deleteBox(box){
    if(!box)return false;
    const quantity=boxQuantity(box);
    const question=quantity?`Удалить ${box.id} и списать из учета ${quantity} ед.?`:`Удалить ${box.id}?`;
    if(!confirm(question))return false;
    (box.items||[]).forEach(item=>{if(Number(item.quantity))recordMovement('box_deleted',-Number(item.quantity),box,item)});
    const index=wms.boxes.indexOf(box);
    if(index>=0)wms.boxes.splice(index,1);
    saveWms(`Удалена коробка ${box.id}${quantity?`, списано ${quantity} ед.`:''}`);
    return true;
  }
  function printBoxLabel(box){
    document.getElementById('qr-print-sheet')?.remove();
    const sheet=document.createElement('section');
    sheet.id='qr-print-sheet';
    sheet.className='qr-print-sheet';
    sheet.innerHTML=`<div class="qr-print-box-id">${esc(box.id)}</div><div class="qr-print-code" id="qr-print-code"></div><div class="qr-print-location">${esc(warehouseName(box.warehouseId))} · ${esc(findZone(box.warehouseId,box.zoneId)?.name||box.zoneId)}</div>`;
    document.body.appendChild(sheet);
    const host=sheet.querySelector('#qr-print-code');
    if(!window.QRCode){sheet.remove();toast('Модуль QR не загружен.','warning');return}
    new QRCode(host,{text:box.qrCode,width:256,height:256,correctLevel:QRCode.CorrectLevel.M});
    let cleaned=false;
    const cleanup=()=>{if(cleaned)return;cleaned=true;document.body.classList.remove('printing-qr');sheet.remove()};
    document.body.classList.add('printing-qr');
    window.addEventListener('afterprint',cleanup,{once:true});
    setTimeout(()=>window.print(),120);
  }
  function openBox(id){const box=wms.boxes.find(item=>item.id===id);if(!box)return;openModal(box.id,`<div class="box-detail"><div id="box-qr" class="qr-host"></div><div><span class="status-pill ${box.locked?'muted':'ok'}">${box.locked?'Заблокирована':'Активна'}</span><h3>${esc(warehouseName(box.warehouseId))} · ${esc(findZone(box.warehouseId,box.zoneId)?.name||box.zoneId)}</h3><p>QR: ${esc(box.qrCode)}</p></div></div><div class="wms-table-wrap"><table class="wms-table"><thead><tr><th>Артикул</th><th>ШК</th><th>Размер</th><th>Остаток</th></tr></thead><tbody>${(box.items||[]).map(item=>`<tr><td>${esc(item.article)}</td><td>${esc(item.barcode)}</td><td>${esc(item.size)}</td><td><b>${Number(item.quantity||0)}</b></td></tr>`).join('')||`<tr><td colspan="4">Коробка пуста</td></tr>`}</tbody></table></div><div class="modal-actions"><button class="btn" id="box-print">Печать QR</button>${['admin','manager'].includes(currentUser?.role)?'<button class="btn" id="box-edit">Изменить / пополнить</button><button class="btn danger-outline" id="box-delete">Удалить</button>':''}<button class="btn" data-close>Закрыть</button></div>`,(modal,close)=>{const host=modal.querySelector('#box-qr');if(window.QRCode)new QRCode(host,{text:box.qrCode,width:160,height:160,correctLevel:QRCode.CorrectLevel.M});modal.querySelector('#box-print').onclick=()=>printBoxLabel(box);modal.querySelector('#box-edit')?.addEventListener('click',()=>{close();openBoxForm(box)});modal.querySelector('#box-delete')?.addEventListener('click',()=>{if(deleteBox(box)){close();render()}})})}
  function downloadBulkReplenishmentTemplate(){
    if(!window.XLSX){toast('Модуль Excel не загружен.','warning');return}
    const sheet=XLSX.utils.aoa_to_sheet([['Баркод','Количество']]);
    sheet['!cols']=[{wch:22},{wch:14}];
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,'Пополнение');
    XLSX.writeFile(workbook,'B-FBS_Массовое_пополнение.xlsx');
  }
  function rowsToBulkReplenishment(rows){
    if(!rows?.length)return {items:[],error:'Файл пуст.'};
    const headers=rows[0].map(normalizeHeader);
    const find=candidates=>headers.findIndex(header=>candidates.some(candidate=>header.includes(candidate)));
    const barcodeIndex=find(['баркод','штрихкод','шк','barcode','sku']);
    const quantityIndex=find(['количество','колво','колич','qty','quantity']);
    if(barcodeIndex<0||quantityIndex<0)return {items:[],error:'Нужны ровно два столбца: Баркод и Количество.'};

    const aggregated=new Map();
    const errors=[];
    rows.slice(1).forEach((row,index)=>{
      const barcode=String(row?.[barcodeIndex]||'').replace(/\.0$/,'').trim();
      const rawQuantity=String(row?.[quantityIndex]??'').trim().replace(/\s/g,'').replace(',','.');
      if(!barcode&&!rawQuantity)return;
      const quantity=Number(rawQuantity);
      if(!barcode){errors.push({row:index+2,message:'Не указан баркод.'});return}
      if(!Number.isInteger(quantity)||quantity<=0){errors.push({row:index+2,barcode,message:'Количество должно быть целым числом больше 0.'});return}
      aggregated.set(barcode,(aggregated.get(barcode)||0)+quantity);
    });

    return {items:[...aggregated].map(([barcode,quantity])=>({barcode,quantity})),errors};
  }
  function bulkTargetBox(warehouseId,barcode){
    const candidates=wms.boxes
      .filter(box=>box.warehouseId===warehouseId&&!box.locked&&!findZone(box.warehouseId,box.zoneId)?.locked&&(box.items||[]).some(item=>item.barcode===barcode))
      .map(box=>({box,item:(box.items||[]).find(item=>item.barcode===barcode)}))
      .sort((a,b)=>{
        const quantityDiff=Number(b.item?.quantity||0)-Number(a.item?.quantity||0);
        if(quantityDiff)return quantityDiff;
        return String(b.box.updatedAt||'').localeCompare(String(a.box.updatedAt||''));
      });
    return candidates[0]||null;
  }
  function openBulkReplenishment(){
    const warehouseId=inventoryWarehouseId();
    if(!warehouseId){toast('Сначала выберите рабочий склад.','warning');return}
    if(!wms.nomenclature.length){toast('Сначала загрузите номенклатуру.','warning');return}

    openModal('Массовое пополнение',`
      <div class="bulk-replenish-intro">
        <div><span>Рабочий склад</span><b>${esc(warehouseName(warehouseId))}</b></div>
        <p>Шаблон содержит только два столбца: «Баркод» и «Количество». B-FBS добавит количество к текущему остатку этого ШК на выбранном складе.</p>
      </div>
      <div class="bulk-template-row">
        <div><b>1. Скачайте шаблон</b><small>Заполните баркоды и количество, не меняя названия двух столбцов.</small></div>
        <button type="button" class="btn" id="bulk-template-download">Скачать шаблон XLSX</button>
      </div>
      <div class="bulk-template-row">
        <div><b>2. Загрузите заполненный файл</b><small>Поддерживаются XLSX, XLS, CSV и TSV.</small></div>
        <input id="bulk-replenish-file" type="file" accept=".xlsx,.xls,.csv,.tsv,.txt">
      </div>
      <div id="bulk-replenish-preview" class="bulk-replenish-preview"><div class="bulk-empty">Файл еще не выбран.</div></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Отмена</button>
        <button type="button" class="btn primary" id="bulk-replenish-confirm" disabled>Пополнить</button>
      </div>
    `,(modal,close)=>{
      const fileInput=modal.querySelector('#bulk-replenish-file');
      const preview=modal.querySelector('#bulk-replenish-preview');
      const confirm=modal.querySelector('#bulk-replenish-confirm');
      let ready=[];

      modal.querySelector('#bulk-template-download').onclick=downloadBulkReplenishmentTemplate;

      const renderPreview=(prepared,fileErrors=[])=>{
        const ok=prepared.filter(item=>item.status==='ready');
        const errors=[...fileErrors,...prepared.filter(item=>item.status==='error')];
        ready=ok;

        const summary=`<div class="bulk-summary"><span class="status-pill">${ok.length} готово</span>${errors.length?`<span class="status-pill error">${errors.length} с ошибкой</span>`:''}<b>+${ok.reduce((sum,item)=>sum+item.quantity,0)} ед.</b></div>`;
        const rows=prepared.length?prepared.map(item=>item.status==='ready'
          ?`<tr><td>${esc(item.barcode)}</td><td><b>${esc(item.sku.article)}</b><small>Размер ${esc(item.sku.size)}</small></td><td><b>+${item.quantity}</b></td><td>${esc(findZone(item.box.warehouseId,item.box.zoneId)?.name||item.box.zoneId)} · ${esc(item.box.id)}</td><td>${Number(item.current)} → <b>${Number(item.current)+item.quantity}</b></td><td><span class="bulk-row-ok">Готово</span></td></tr>`
          :`<tr class="bulk-row-error"><td>${esc(item.barcode||'—')}</td><td colspan="4">${esc(item.message)}</td><td><span>Ошибка</span></td></tr>`
        ).join(''):'';

        const parseErrors=fileErrors.map(error=>`<tr class="bulk-row-error"><td>${esc(error.barcode||'Строка '+error.row)}</td><td colspan="4">${esc(error.message)}</td><td><span>Ошибка</span></td></tr>`).join('');

        preview.innerHTML=`${summary}<div class="wms-table-wrap bulk-preview-table"><table class="wms-table"><thead><tr><th>Баркод</th><th>Товар</th><th>Добавить</th><th>Куда</th><th>Остаток</th><th>Статус</th></tr></thead><tbody>${rows}${parseErrors}</tbody></table></div>`;
        confirm.disabled=!ok.length;
        confirm.textContent=ok.length?`Пополнить ${ok.length} поз.`:'Пополнить';
      };

      fileInput.onchange=async()=>{
        const file=fileInput.files[0];if(!file)return;
        ready=[];confirm.disabled=true;preview.innerHTML='<div class="bulk-empty">Чтение файла…</div>';
        try{
          if(file.size>10*1024*1024)throw new Error('Файл слишком большой. Максимальный размер — 10 МБ.');
          let rows;
          if(/\.xlsx?$/i.test(file.name))rows=workbookRows(await file.arrayBuffer());
          else rows=parseDelimited(await file.text());

          const parsed=rowsToBulkReplenishment(rows);
          if(parsed.error)throw new Error(parsed.error);

          const prepared=parsed.items.map(row=>{
            const sku=itemByBarcode(row.barcode);
            if(!sku)return {...row,status:'error',message:'Баркод отсутствует в номенклатуре.'};
            const target=bulkTargetBox(warehouseId,row.barcode);
            if(!target)return {...row,status:'error',sku,message:'На выбранном складе нет активной коробки с этим ШК. Сначала разместите товар вручную.'};
            return {...row,status:'ready',sku,box:target.box,current:Number(target.item?.quantity||0)};
          });
          renderPreview(prepared,parsed.errors||[]);
        }catch(error){
          ready=[];confirm.disabled=true;
          preview.innerHTML=`<div class="bulk-empty error-text">${esc(error.message)}</div>`;
        }
      };

      confirm.onclick=()=>{
        if(!ready.length)return;
        const total=ready.reduce((sum,row)=>sum+row.quantity,0);
        ready.forEach(row=>{
          const box=wms.boxes.find(item=>item.id===row.box.id);
          const sku=itemByBarcode(row.barcode);
          if(!box||!sku)return;
          const item=upsertBoxItem(box,sku,row.quantity);
          recordMovement('bulk_replenishment',row.quantity,box,item,'Массовое пополнение');
        });
        saveWms(`Массовое пополнение: ${ready.length} поз., +${total} ед. · ${warehouseName(warehouseId)}`);
        close();
        toast(`Массовое пополнение завершено: +${total} ед. (${ready.length} поз.).`,'success');
        renderInventoryTable();
      };
    });
  }

  function openReplenishment(){
    if(!wms.nomenclature.length){toast('Сначала загрузите номенклатуру.','warning');return}
    openModal('Пополнение остатков',`<form class="wms-form" id="replenish-form"><label>Баркод товара<input name="barcode" list="sku-barcodes" autocomplete="off" required><datalist id="sku-barcodes">${wms.nomenclature.map(item=>`<option value="${esc(item.barcode)}">${esc(item.article)} · ${esc(item.size)}</option>`).join('')}</datalist></label><label>Коробка<select name="boxId" id="replenish-box"><option value="">Сначала укажите баркод</option></select></label><label>Количество<input name="quantity" type="number" min="1" value="1" required></label><div class="form-error"></div><div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Оприходовать</button></div></form>`,(modal,close)=>{const form=modal.querySelector('form'),barcode=form.elements.barcode,boxSelect=form.elements.boxId;const update=()=>{const matches=wms.boxes.filter(box=>!box.locked&&!findZone(box.warehouseId,box.zoneId)?.locked&&(box.items||[]).some(item=>item.barcode===barcode.value.trim()));boxSelect.innerHTML=matches.map(box=>`<option value="${esc(box.id)}">${esc(box.id)} · ${esc(findZone(box.warehouseId,box.zoneId)?.name||box.zoneId)} · ${Number(box.items.find(item=>item.barcode===barcode.value.trim())?.quantity||0)} ед.</option>`).join('')||'<option value="">Подходящих коробок нет</option>'};barcode.oninput=update;form.onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form)),sku=itemByBarcode(data.barcode),box=wms.boxes.find(item=>item.id===data.boxId),quantity=Number(data.quantity);if(!sku){form.querySelector('.form-error').innerHTML='<div class="error">Баркод отсутствует в номенклатуре.</div>';return}if(!box){form.querySelector('.form-error').innerHTML='<div class="error">Создайте коробку в нужной зоне и повторите операцию.</div>';return}const item=upsertBoxItem(box,sku,quantity);recordMovement('replenishment',quantity,box,item);saveWms(`Пополнение ${sku.article}: +${quantity}`);close();toast('Остаток обновлён.','success');renderInventoryTable()};barcode.focus()})
  }
})();
