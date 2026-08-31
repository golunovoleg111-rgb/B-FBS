/* B-FBS Workspace v5 — compact object layout, safe geometry and minimap interaction. */
(function(){
  const originalRender=window.render;

  function labelLines(name){
    const map={'Рабочая зона сборщиков':['Рабочая зона','сборщиков'],'Место для коробок':['Место для','коробок'],'Место для мусора':['Место для','мусора'],'Вход':['Вход'],'Окно':['Окно'],'Ворота':['Ворота'],'Перегородка':['Перегородка']};
    return map[name]||[name];
  }
  function overlaps(a,b,gap=10){return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y}
  function clampObject(o,b,margin){
    if(!b||o.name==='Вход')return false;
    let changed=false;
    const maxW=Math.max(20,b.maxX-b.minX-margin*2),maxH=Math.max(20,b.maxY-b.minY-margin*2);
    if(o.w>maxW){o.w=maxW;changed=true} if(o.h>maxH){o.h=maxH;changed=true}
    const nx=Math.max(b.minX+margin,Math.min(b.maxX-margin-o.w,o.x));
    const ny=Math.max(b.minY+margin,Math.min(b.maxY-margin-o.h,o.y));
    if(nx!==o.x){o.x=nx;changed=true} if(ny!==o.y){o.y=ny;changed=true}
    return changed;
  }
  function normalizeObjects(){
    if(!draft?.objects?.length||typeof bounds!=='function')return false;
    const b=bounds();if(!b)return false;let changed=false;
    // Keep objects visually close to the warehouse wall while leaving only a small
    // clearance so their borders do not sit directly on top of the wall stroke.
    const margin=8;
    draft.objects.forEach(o=>{changed=clampObject(o,b,margin)||changed});
    for(let pass=0;pass<12;pass++){
      let moved=false;
      for(let i=0;i<draft.objects.length;i++){
        const a=draft.objects[i];if(a.name==='Вход')continue;
        for(let j=0;j<i;j++){
          const c=draft.objects[j];if(c.name==='Вход'||!overlaps(a,c,8))continue;
          const left=(a.x+a.w)-(c.x-8),right=(c.x+c.w+8)-a.x,up=(a.y+a.h)-(c.y-8),down=(c.y+c.h+8)-a.y;
          if(Math.min(left,right)<=Math.min(up,down))a.x+=(a.x<c.x?-left:right);else a.y+=(a.y<c.y?-up:down);
          clampObject(a,b,margin);moved=true;changed=true;
        }
      }
      if(!moved)break;
    }
    return changed;
  }
  window.renderObjects=function(objects){
    return objects.map((o,i)=>{
      const t=OBJECT_TYPES[o.name]||OBJECT_TYPES['Перегородка'];
      const sel=selected?.kind==='object'&&selected.index===i;
      const width=Math.max(20,o.w),height=Math.max(20,o.h),minSide=Math.min(width,height);
      const compact=minSide<75,micro=minSide<42,lines=labelLines(o.name);
      const iconSize=micro?10:compact?13:Math.max(12,Math.min(18,minSide/5));
      const labelSize=Math.max(8,Math.min(12,Math.min(width/Math.max(6,lines[0].length),height/(lines.length+2))));
      const centerX=o.x+width/2,centerY=o.y+height/2,iconY=compact?centerY-iconSize*.35:centerY-(lines.length*labelSize*.45),lineHeight=Math.max(10,labelSize+2);
      const label=lines.map((line,n)=>`<tspan x="${centerX}" dy="${n===0?0:lineHeight}">${esc(line)}</tspan>`).join('');
      const controlR=Math.max(5,Math.min(8,minSide*.16)),deleteX=o.x+width-controlR-3,deleteY=o.y+controlR+3,handle=Math.max(7,Math.min(11,minSide*.2)),handleX=o.x+width-handle,handleY=o.y+height-handle;
      return `<g class="placed-svg-object ${t.cls} ${sel?'selected ':''}${compact?'compact ':''}${micro?'micro':''}" data-object-index="${i}"><rect class="object-body" data-object-index="${i}" x="${o.x}" y="${o.y}" width="${width}" height="${height}" rx="8"/><text x="${centerX}" y="${iconY}" class="object-svg-icon" data-object-index="${i}" text-anchor="middle" dominant-baseline="middle" style="font-size:${iconSize}px">${t.icon}</text>${compact?'':`<text x="${centerX}" y="${centerY+lineHeight*.55}" class="object-svg-label" data-object-index="${i}" text-anchor="middle" style="font-size:${labelSize}px">${label}</text>`}${sel?`<g class="object-action" data-delete-object="${i}"><circle class="object-delete" data-delete-object="${i}" cx="${deleteX}" cy="${deleteY}" r="${controlR}"/><text class="object-delete-x" x="${deleteX}" y="${deleteY+4}" data-delete-object="${i}">×</text></g><rect class="object-resize" data-resize-object="${i}" x="${handleX}" y="${handleY}" width="${handle}" height="${handle}" rx="1"/>`:''}</g>`;
    }).join('');
  };
  function bindMinimap(){
    const stage=document.getElementById('floor'),minimap=stage?.querySelector('.minimap');if(!stage||!minimap)return;
    const update=e=>{const r=minimap.getBoundingClientRect();const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;minimap.classList.toggle('is-hidden',inside)};
    stage.addEventListener('pointermove',update,{passive:true});
    stage.addEventListener('pointerdown',e=>{const r=minimap.getBoundingClientRect();if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)minimap.classList.add('is-hidden')},{passive:true});
    stage.addEventListener('pointerleave',()=>minimap.classList.remove('is-hidden'));
  }
  window.render=function(){
    if(typeof originalRender==='function')originalRender();
    if(activeTab==='workspace'&&(workspaceMode==='objects'||workspaceMode==='management')){
      const changed=normalizeObjects();if(changed){persist();originalRender()}bindMinimap();
    }
  };
  const originalPersist=window.persist;
  window.persist=function(){if(activeTab==='workspace'&&(workspaceMode==='objects'||workspaceMode==='management'))normalizeObjects();return originalPersist.apply(this,arguments)};
  if(typeof originalRender==='function')window.render();
})();
