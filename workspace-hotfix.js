/* B-FBS workspace visual/interactions hotfix. Loaded after app.js. */
(function(){
  const originalRenderObjects = window.renderObjects;

  function labelLines(name){
    const map={
      'Рабочая зона сборщиков':['Рабочая зона','сборщиков'],
      'Место для коробок':['Место для','коробок'],
      'Место для мусора':['Место для','мусора'],
      'Вход':['Вход'],
      'Окно':['Окно'],
      'Ворота':['Ворота'],
      'Перегородка':['Перегородка']
    };
    return map[name]||[name];
  }

  window.renderObjects=function(objects){
    return objects.map((o,i)=>{
      const t=OBJECT_TYPES[o.name]||OBJECT_TYPES['Перегородка'];
      const sel=selected?.kind==='object'&&selected.index===i;
      const width=Math.max(20,o.w),height=Math.max(20,o.h);
      const lines=labelLines(o.name);
      const lineHeight=Math.min(15,Math.max(11,height/Math.max(2,lines.length+1)));
      const startY=o.y+height/2+(lines.length-1)*lineHeight/2;
      const label=lines.map((line,n)=>`<tspan x="${o.x+width/2}" dy="${n===0?0:lineHeight}">${esc(line)}</tspan>`).join('');
      return `<g class="placed-svg-object ${t.cls} ${sel?'selected':''}" data-object-index="${i}">
        <rect class="object-body" data-object-index="${i}" x="${o.x}" y="${o.y}" width="${width}" height="${height}" rx="8"/>
        <text x="${o.x+width/2}" y="${startY-lineHeight/2}" class="object-svg-icon" data-object-index="${i}">${t.icon}</text>
        <text x="${o.x+width/2}" y="${startY+lineHeight/2}" class="object-svg-label" data-object-index="${i}">${label}</text>
        ${sel?`<g class="object-action" data-delete-object="${i}"><circle class="object-delete" cx="${o.x+width-13}" cy="${o.y+13}" r="9"/><text class="object-delete-x" data-delete-object="${i}" x="${o.x+width-13}" y="${o.y+17}">×</text></g><rect class="object-resize" data-resize-object="${i}" x="${o.x+width-13}" y="${o.y+height-13}" width="13" height="13"/>`:''}
      </g>`;
    }).join('');
  };

  function nearestEntrance(x,y,w,h){
    const b=bounds();
    if(!b)return null;
    const candidates=[
      {edge:'top',d:Math.abs(y-b.minY),center:x+w/2},
      {edge:'bottom',d:Math.abs(y+h-b.maxY),center:x+w/2},
      {edge:'left',d:Math.abs(x-b.minX),center:y+h/2},
      {edge:'right',d:Math.abs(x+w-b.maxX),center:y+h/2}
    ];
    const hit=candidates.sort((a,b)=>a.d-b.d)[0];
    /* The user may draw slightly inside the wall. We snap the result to it. */
    const tolerance=180;
    if(hit.d>tolerance)return null;
    const doorLong=Math.max(80,Math.min(180,(hit.edge==='top'||hit.edge==='bottom'?w:h)||100));
    const thickness=14;
    if(hit.edge==='top'||hit.edge==='bottom'){
      const x0=Math.max(b.minX,Math.min(hit.center-doorLong/2,b.maxX-doorLong));
      return {x:snap(x0),y:snap(b.minY-thickness/2),w:snap(doorLong),h:thickness};
    }
    const y0=Math.max(b.minY,Math.min(hit.center-doorLong/2,b.maxY-doorLong));
    return {x:snap(b.minX-thickness/2),y:snap(y0),w:thickness,h:snap(doorLong)};
  }

  function hotfixPointerUp(e){
    if(!pointerAction)return;
    if(pointerAction==='draw-object'){
      const a=drawStart,b=drawCurrent;
      const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);
      if(w>20&&h>20){
        let placed=null;
        if(selectedObjectType==='Вход')placed=nearestEntrance(x,y,w,h);
        else if(insideWarehouse(x,y,w,h))placed={x,y,w,h};
        if(placed){
          commitHistory();
          draft.objects.push({name:selectedObjectType,...placed});
          selected={kind:'object',index:draft.objects.length-1};
          tool='select';
        }else{
          alert(selectedObjectType==='Вход'?'Наведите прямоугольник входа на любую стену склада.':'Объект нельзя разместить за пределами стен склада.');
        }
        drawStart=null;drawCurrent=null;pointerAction=null;
        e.currentTarget.classList.remove('panning');
        try{e.currentTarget.releasePointerCapture(e.pointerId)}catch(_){}
        persist();render();
        return;
      }
      drawStart=null;drawCurrent=null;pointerAction=null;
      try{e.currentTarget.releasePointerCapture(e.pointerId)}catch(_){}
      updateCanvas();
      return;
    }
    return onPointerUp(e);
  }

  window.onPointerUp=hotfixPointerUp;

  /* Rebind after replacing renderObjects/onPointerUp. */
  if(typeof render==='function')render();
})();
