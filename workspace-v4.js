/* B-FBS Workspace v4: multi-warehouse management + published viewport constraints. */
(function(){
  const WAREHOUSE_KEY='b-fbs-warehouses-v1';
  let warehouses=[];
  let activeWarehouseId=null;

  const blankDraft=(name='Склад')=>({name,width:40,height:20,walls:[],objects:[],grid:.5,snap:true});
  const blankView=()=>({zoom:1,panX:0,panY:0});
  const normalizeView=value=>{
    if(!value||!Number.isFinite(Number(value.zoom))||!Number.isFinite(Number(value.panX))||!Number.isFinite(Number(value.panY)))return null;
    return {zoom:Math.max(ZOOM.min,Math.min(ZOOM.max,Number(value.zoom))),panX:Number(value.panX),panY:Number(value.panY)};
  };

  function readWarehouses(){
    try{
      const raw=JSON.parse(localStorage.getItem(WAREHOUSE_KEY)||'null');
      if(Array.isArray(raw)&&raw.length){warehouses=raw;activeWarehouseId=raw[0].id;return true;}
    }catch(e){console.warn(e)}
    return false;
  }

  function migrateCurrent(){
    if(readWarehouses()){
      const current=warehouses.find(w=>w.id===activeWarehouseId)||warehouses[0];
      activeWarehouseId=current.id;
      draft=clone(current.draft||blankDraft(current.name));
      published=clone(current.published||null);
      zones=clone(current.zones||[]);
      versions=clone(current.versions||[]);
      const savedView=normalizeView(current.view);
      view=savedView||blankView();
      window.__bfbsWorkspaceNeedsFit=!savedView;
      workspaceMode=published?'management':'design';
      return;
    }
    const id='wh-'+Date.now();
    warehouses=[{id,name:draft.name||'Склад 1',draft:clone(draft),published:clone(published),zones:clone(zones),versions:clone(versions)}];
    activeWarehouseId=id;
    localStorage.setItem(WAREHOUSE_KEY,JSON.stringify(warehouses));
  }

  function syncWarehouse(){
    if(!activeWarehouseId)return;
    const item=warehouses.find(w=>w.id===activeWarehouseId);
    if(!item)return;
    item.name=draft.name||item.name;
    item.draft=clone(draft);
    item.published=clone(published);
    item.zones=clone(zones);
    item.versions=clone(versions);
    item.view=clone(view);
    localStorage.setItem(WAREHOUSE_KEY,JSON.stringify(warehouses));
  }

  function enhancedPersist(){
    localStorage.setItem('b-fbs-workspace',JSON.stringify({draft,published,zones,versions}));
    syncWarehouse();
  }
  window.persist=enhancedPersist;

  function currentWarehouse(){return warehouses.find(w=>w.id===activeWarehouseId)||null}

  function renameWarehouse(){
    const item=currentWarehouse();if(!item)return;
    const modal=document.createElement('div');
    modal.className='modal-backdrop';
    modal.innerHTML=`<section class="modal"><button class="modal-close" type="button" data-close>×</button><h2>Переименовать склад</h2><p>Название изменится во всех рабочих представлениях склада.</p><form class="form" id="warehouse-rename-form"><label>Название<input name="name" maxlength="80" value="${esc(item.name)}" required></label><div class="form-error"></div><div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Сохранить</button></div></form></section>`;
    document.body.appendChild(modal);
    const close=()=>modal.remove();
    modal.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',close));
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    const form=modal.querySelector('form'),input=form.elements.name;input.focus();input.select();
    form.onsubmit=event=>{
      event.preventDefault();
      const name=input.value.trim();
      if(!name){form.querySelector('.form-error').innerHTML='<div class="error">Введите название склада.</div>';return}
      item.name=name;draft.name=name;if(published)published.name=name;
      persist();close();render();
    };
  }

  function activateWarehouse(id){
    const item=warehouses.find(w=>w.id===id);if(!item)return;
    syncWarehouse();
    activeWarehouseId=id;
    draft=clone(item.draft||blankDraft(item.name));
    published=clone(item.published||null);
    zones=clone(item.zones||[]);
    versions=clone(item.versions||[]);
    workspaceMode=published?'management':'design';
    tool='select';selectedObjectType=null;selected=null;drawStart=null;drawCurrent=null;pointerAction=null;
    const savedView=normalizeView(item.view);
    view=savedView||blankView();
    window.__bfbsWorkspaceNeedsFit=!savedView;
    persist();
    render();
  }

  function createWarehouse(){
    syncWarehouse();
    const id='wh-'+Date.now();
    const number=warehouses.length+1;
    const d=blankDraft('Склад '+number);
    const initialView=blankView();
    const item={id,name:d.name,draft:d,published:null,zones:[],versions:[],view:initialView};
    warehouses.push(item);activeWarehouseId=id;
    draft=clone(d);published=null;zones=[];versions=[];workspaceMode='design';tool='select';selected=null;view=clone(initialView);
    window.__bfbsWorkspaceNeedsFit=false;
    localStorage.setItem(WAREHOUSE_KEY,JSON.stringify(warehouses));
    render();
  }

  function deleteWarehouse(){
    const item=currentWarehouse();if(!item)return;
    if(!confirm(`Удалить склад «${item.name}»?\nБудут удалены его схема, версии и данные зон. Действие нельзя отменить.`))return;
    warehouses=warehouses.filter(w=>w.id!==item.id);
    if(warehouses.length){
      activeWarehouseId=warehouses[0].id;
      const next=warehouses[0];draft=clone(next.draft||blankDraft(next.name));published=clone(next.published||null);zones=clone(next.zones||[]);versions=clone(next.versions||[]);workspaceMode=published?'management':'design';
      const savedView=normalizeView(next.view);view=savedView||blankView();window.__bfbsWorkspaceNeedsFit=!savedView;
    }else{
      activeWarehouseId=null;draft=blankDraft('Новый склад');published=null;zones=[];versions=[];workspaceMode='design';view=blankView();window.__bfbsWorkspaceNeedsFit=false;
    }
    tool='select';selected=null;
    localStorage.setItem(WAREHOUSE_KEY,JSON.stringify(warehouses));
    persist();render();
  }

  function warehouseSwitcher(){
    return `<div class="warehouse-manager"><div class="warehouse-manager-label">СКЛАД</div><div class="warehouse-manager-row"><select id="warehouse-select" ${warehouses.length?'':'disabled'}>${warehouses.map(w=>`<option value="${esc(w.id)}" ${w.id===activeWarehouseId?'selected':''}>${esc(w.name)}</option>`).join('')}</select><button class="btn" id="new-warehouse">+ Склад</button><button class="btn" id="rename-warehouse" ${activeWarehouseId?'':'disabled'}>Переименовать</button><button class="btn danger-outline" id="delete-warehouse" ${activeWarehouseId?'':'disabled'}>Удалить</button></div>${activeWarehouseId?`<div class="warehouse-manager-meta">${published?'Опубликованная схема':'Черновик'} · ${draft.width} × ${draft.height} м</div>`:'<div class="warehouse-manager-meta">Складов нет — создайте новый.</div>'}</div>`;
  }

  const originalWorkspaceView=window.workspaceView;
  window.workspaceView=function(){
    const result=originalWorkspaceView();
    return result.replace(/<aside class="tool-panel panel">/,`<aside class="tool-panel panel">${warehouseSwitcher()}`);
  };

  function enhancedClampPan(){
    const source=workspaceMode==='management'&&published?published:draft;
    const b=boundsFor(source.walls);
    const vw=VIEW.w/view.zoom,vh=VIEW.h/view.zoom;
    if(!b){
      const maxX=Math.max(0,WORLD.w-vw),maxY=Math.max(0,WORLD.h-vh);
      view.panX=Math.max(0,Math.min(maxX,view.panX));view.panY=Math.max(0,Math.min(maxY,view.panY));return;
    }
    const bw=b.maxX-b.minX,bh=b.maxY-b.minY;
    if(vw>=bw)view.panX=b.minX-(vw-bw)/2;else view.panX=Math.max(b.minX,Math.min(b.maxX-vw,view.panX));
    if(vh>=bh)view.panY=b.minY-(vh-bh)/2;else view.panY=Math.max(b.minY,Math.min(b.maxY-vh,view.panY));
  }
  function boundsFor(walls){
    if(!walls||!walls.length)return null;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    walls.forEach(w=>{if(w.type==='line'){minX=Math.min(minX,w.x1,w.x2);minY=Math.min(minY,w.y1,w.y2);maxX=Math.max(maxX,w.x1,w.x2);maxY=Math.max(maxY,w.y1,w.y2)}else{minX=Math.min(minX,w.x);minY=Math.min(minY,w.y);maxX=Math.max(maxX,w.x+w.w);maxY=Math.max(maxY,w.y+w.h)}});
    return {minX,minY,maxX,maxY};
  }
  window.clampPan=enhancedClampPan;

  window.fitView=function(){
    const source=workspaceMode==='management'&&published?published:draft;
    const b=boundsFor(source.walls);
    if(!b){view.zoom=1;view.panX=0;view.panY=0;render();return;}
    const pad=workspaceMode==='management'?40:100;
    view.zoom=Math.max(ZOOM.min,Math.min(ZOOM.max,Math.min(VIEW.w/(b.maxX-b.minX+pad),VIEW.h/(b.maxY-b.minY+pad))));
    enhancedClampPan();
    render();
  };

  function bindWarehouseControls(){
    document.getElementById('warehouse-select')?.addEventListener('change',e=>activateWarehouse(e.target.value));
    document.getElementById('new-warehouse')?.addEventListener('click',createWarehouse);
    document.getElementById('rename-warehouse')?.addEventListener('click',renameWarehouse);
    document.getElementById('delete-warehouse')?.addEventListener('click',deleteWarehouse);
  }

  const originalBindWorkspace=window.bindWorkspace;
  window.bindWorkspace=function(){
    originalBindWorkspace();
    bindWarehouseControls();
  };

  function enhancedRender(){
    if(sessionStorage.getItem(AUTH_KEY)!=='admin'){loginView();return}
    if(activeTab==='workspace'&&workspaceMode==='management')enhancedClampPan();
    let c=activeTab==='dashboard'?dashboardView():activeTab==='workspace'?workspaceView():placeholderView(TABS.find(t=>t[0]===activeTab));
    root.innerHTML=shell(c);bindCommon();
    if(activeTab==='workspace')bindWorkspace();
  }
  window.render=enhancedRender;

  migrateCurrent();
  window.addEventListener('resize',()=>{if(activeTab==='workspace'){enhancedClampPan();updateCanvas()}});
  render();
})();
