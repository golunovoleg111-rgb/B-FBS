'use strict';
/* B-FBS PR16: workspace interaction and camera stability fixes. */
(function(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  let action=null, initialFitDone=false;
  const aw=()=>active();
  const wb=w=>{try{return bounds(w)}catch(e){return null}};
  const point=e=>pt(e);
  const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

  function clampCamera(){
    const w=aw(),b=wb(w); if(!b)return;
    const vw=WORLD.w/zoom,vh=WORLD.h/zoom;
    const bw=b.r-b.l,bh=b.b-b.t;
    pan.x=vw>=bw?b.l-(vw-bw)/2:clamp(pan.x,b.l,b.r-vw);
    pan.y=vh>=bh?b.t-(vh-bh)/2:clamp(pan.y,b.t,b.b-vh);
  }
  function fitWarehouse(){
    initialFitDone=true;
    const w=aw(),b=wb(w); if(!b){zoom=1;pan={x:0,y:0};originalRenderW();return;}
    const pad=80,bw=Math.max(1,b.r-b.l+pad),bh=Math.max(1,b.b-b.t+pad);
    zoom=clamp(Math.min(WORLD.w/bw,WORLD.h/bh),.25,4);
    const vw=WORLD.w/zoom,vh=WORLD.h/zoom;
    pan.x=b.l-(vw-(b.r-b.l))/2;
    pan.y=b.t-(vh-(b.b-b.t))/2;
    originalRenderW();
  }
  function validObject(o,w){
    const b=wb(w);if(!b)return false;
    if(o.x<b.l+2||o.y<b.t+2||o.x+o.w>b.r-2||o.y+o.h>b.b-2)return false;
    return !w.objects.some((x,i)=>i!== (sel?.kind==='object'?sel.i:-1) && overlap(o,x));
  }

  const originalRenderW=renderW;
  window.renderW=function(){
    const w=aw();
    if(mode==='management'&&w?.published&&!initialFitDone){fitWarehouse();return;}
    originalRenderW();
  };

  window.bindW=function(){
    const st=document.getElementById('stage');if(!st)return;
    st.onmousedown=e=>{
      if(e.button!==0&&e.button!==1)return;
      const p=point(e),w=aw(),target=e.target.closest?.('[data-wall],[data-object],[data-zone]');
      if(e.button===1||(e.button===0&&!target&&tool==='select')){
        action={type:'pan',sx:e.clientX,sy:e.clientY};st.classList.add('panning');return;
      }
      if(e.button!==0)return;
      if(mode==='design'&&tool==='eraser'&&target?.dataset.wall!==undefined){w.walls.splice(+target.dataset.wall,1);sel=null;save();originalRenderW();return;}
      if(mode==='design'&&tool==='select'&&target?.dataset.wall!==undefined){sel={kind:'wall',i:+target.dataset.wall};action={type:'wall',sx:p.x,sy:p.y};originalRenderW();return;}
      if(mode==='design'&&(tool==='line'||tool==='rectangle')){draw={x:sp(p.x),y:sp(p.y),x2:sp(p.x),y2:sp(p.y),type:tool};action={type:'draw-wall'};originalRenderW();return;}
      if(mode==='objects'&&tool==='object'){draw={x:sp(p.x),y:sp(p.y),x2:sp(p.x),y2:sp(p.y),type:'object',name:otype};action={type:'draw-object'};originalRenderW();return;}
      if(mode==='objects'&&tool==='eraser'&&target?.dataset.object!==undefined){w.objects.splice(+target.dataset.object,1);sel=null;save();originalRenderW();return;}
      if(target?.dataset.object!==undefined){const i=+target.dataset.object;sel={kind:'object',i};const o=w.objects[i];action={type:'object-move',offsetX:p.x-o.x,offsetY:p.y-o.y};originalRenderW();return;}
      if(target?.dataset.zone!==undefined&&mode==='management'){sel={kind:'zone',i:+target.dataset.zone};openZone(+target.dataset.zone);return;}
    };
    st.onmousemove=e=>{
      if(!action)return;const p=point(e),w=aw();
      if(action.type==='pan'){const r=st.getBoundingClientRect(),vw=WORLD.w/zoom,vh=WORLD.h/zoom;pan.x-= (e.clientX-action.sx)/r.width*vw;pan.y-=(e.clientY-action.sy)/r.height*vh;action.sx=e.clientX;action.sy=e.clientY;clampCamera();originalRenderW();return;}
      if(action.type==='draw-wall'||action.type==='draw-object'){draw.x2=sp(p.x);draw.y2=sp(p.y);originalRenderW();return;}
      if(action.type==='object-move'){const o=w.objects[sel.i],b=wb(w);if(o&&b){o.x=clamp(sp(p.x-action.offsetX),b.l+2,b.r-o.w-2);o.y=clamp(sp(p.y-action.offsetY),b.t+2,b.b-o.h-2);}originalRenderW();return;}
      if(action.type==='wall'){const wall=w.walls[sel.i],b=wb(w);if(wall?.type==='rect'&&b){wall.x=clamp(sp(wall.x+(p.x-action.sx)),b.l,b.r-wall.w);wall.y=clamp(sp(wall.y+(p.y-action.sy)),b.t,b.b-wall.h);action.sx=p.x;action.sy=p.y;originalRenderW();}}
    };
    st.onmouseup=()=>{
      if(!action)return;const a=action,w=aw();
      if(a.type==='draw-wall'&&draw){const d=draw,rw=Math.abs(d.x2-d.x),rh=Math.abs(d.y2-d.y);if(rw>20||rh>20){if(d.type==='line')w.walls.push({id:uid('wall'),type:'line',x1:d.x,y1:d.y,x2:d.x2,y2:d.y2});else w.walls.push({id:uid('wall'),type:'rect',x:Math.min(d.x,d.x2),y:Math.min(d.y,d.y2),w:rw,h:rh});save();sel={kind:'wall',i:w.walls.length-1};}draw=null;originalRenderW();}
      else if(a.type==='draw-object'&&draw){const d=draw,rw=Math.abs(d.x2-d.x),rh=Math.abs(d.y2-d.y),o={id:uid('obj'),name:d.name,x:Math.min(d.x,d.x2),y:Math.min(d.y,d.y2),w:rw,h:rh};if(rw>20&&rh>20){const b=wb(w);if(o.name==='Вход'){const edge=[['t',Math.abs(o.y-b.t)],['b',Math.abs(o.y+o.h-b.b)],['l',Math.abs(o.x-b.l)],['r',Math.abs(o.x+o.w-b.r)]].sort((x,y)=>x[1]-y[1])[0];if(edge[1]<=100){if(edge[0]==='t'||edge[0]==='b'){o.y=edge[0]==='t'?b.t-o.h/2:b.b-o.h/2;o.x=clamp(o.x,b.l,b.r-o.w);}else{o.x=edge[0]==='l'?b.l-o.w/2:b.r-o.w/2;o.y=clamp(o.y,b.t,b.b-o.h);}w.objects.push(o);sel={kind:'object',i:w.objects.length-1};}else toast('Вход размещается только на стене склада','error');}else if(validObject(o,w)){w.objects.push(o);sel={kind:'object',i:w.objects.length-1};}else toast('Объект должен быть внутри склада и не пересекать другие объекты','error');save();}draw=null;tool='select';originalRenderW();}
      else if(a.type==='object-move'){save();originalRenderW();}
      action=null;st.classList.remove('panning');
    };
    st.onmouseleave=()=>{if(action?.type==='pan'){action=null;st.classList.remove('panning')}};
    st.onwheel=e=>{e.preventDefault();const p=point(e),old=zoom;zoom=clamp(zoom*(e.deltaY<0?1.1:.9),.25,4);pan.x=p.x-(p.x-pan.x)*(old/zoom);pan.y=p.y-(p.y-pan.y)*(old/zoom);clampCamera();originalRenderW();};
    document.getElementById('zo+')?.addEventListener('click',()=>{zoom=clamp(zoom+.1,.25,4);clampCamera();originalRenderW()});
    document.getElementById('zo-')?.addEventListener('click',()=>{zoom=clamp(zoom-.1,.25,4);clampCamera();originalRenderW()});
    document.getElementById('fit')?.addEventListener('click',fitWarehouse);
    document.getElementById('gt')?.addEventListener('click',()=>{grid=!grid;originalRenderW()});
    document.getElementById('st')?.addEventListener('click',()=>{snap=!snap;originalRenderW()});
    document.getElementById('full')?.addEventListener('click',fullMap);
    document.getElementById('api2')?.addEventListener('click',apiModal);
    document.getElementById('to2')?.addEventListener('click',()=>{mode='objects';tool='select';initialFitDone=false;fitWarehouse()});
    document.getElementById('back')?.addEventListener('click',()=>{mode='design';tool='select';initialFitDone=false;originalRenderW()});
    document.getElementById('publish')?.addEventListener('click',publish);
    document.getElementById('remove')?.addEventListener('click',removeSel);
    document.getElementById('size')?.addEventListener('click',size);
    document.getElementById('clear')?.addEventListener('click',()=>{if(confirm('Очистить стены и объекты?')){w.walls=[];w.objects=[];save();originalRenderW()}});
    document.getElementById('copy')?.addEventListener('click',copy);
    document.getElementById('zone-add')?.addEventListener('click',startZoneDrawing);
    document.getElementById('newwh')?.addEventListener('click',newWh);
    document.getElementById('delwh')?.addEventListener('click',delWh);
    document.getElementById('whsel')?.addEventListener('change',e=>{wid=e.target.value;mode=aw().published?'management':'design';zoom=1;pan={x:0,y:0};initialFitDone=false;originalRenderW();});
    document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;otype='';sel=null;originalRenderW()});
    document.querySelectorAll('[data-ot]').forEach(b=>b.onclick=()=>{tool='object';otype=b.dataset.ot;sel=null;originalRenderW()});
    document.getElementById('oselect')?.addEventListener('click',()=>{tool='select';otype='';originalRenderW()});
  };

  function startZoneDrawing(){
    const st=document.getElementById('stage');if(!st)return;
    st.onmousedown=e=>{if(e.button!==0)return;const p=point(e);draw={x:sp(p.x),y:sp(p.y),x2:sp(p.x),y2:sp(p.y),type:'zone'};action={type:'draw-zone'};};
    st.onmousemove=e=>{if(action?.type!=='draw-zone')return;const p=point(e);draw.x2=sp(p.x);draw.y2=sp(p.y);originalRenderW();};
    st.onmouseup=()=>{if(!draw||action?.type!=='draw-zone')return;const d=draw,w=aw(),z={id:uid('z'),name:'Новая зона',capacity:100,x:Math.min(d.x,d.x2),y:Math.min(d.y,d.y2),w:Math.abs(d.x2-d.x),h:Math.abs(d.y2-d.y),boxes:[],locked:false};const b=wb(w),valid=b&&z.w>20&&z.h>20&&z.x>=b.l+2&&z.y>=b.t+2&&z.x+z.w<=b.r-2&&z.y+z.h<=b.b-2&&!w.zones.some(x=>overlap(z,x));draw=null;action=null;if(!valid){toast('Зона должна быть полностью внутри склада и не пересекать другую зону','error');originalRenderW();return;}zoneCreate(z);};
  }
  window.zoneMode=startZoneDrawing;

  const originalWorkspace=workspace;
  window.workspace=function(){if(mode==='management'){const old=grid;grid=false;const html=originalWorkspace();grid=old;return html;}return originalWorkspace();};

  window.fullMap=function(){
    const w=aw(),b=wb(w);if(!b){return;}
    open(`<div class="fullscreen-modal"><div class="fullscreen-head"><b>${esc(w.name)} · полная карта</b><span>Демонстрационный режим</span><button class="icon-btn" data-close>×</button></div><div class="fullscreen-map"><svg viewBox="${b.l} ${b.t} ${b.r-b.l} ${b.b-b.t}" preserveAspectRatio="xMidYMid meet">${walls(w.walls)}${objects(w.objects)}${zones(w.zones)}</svg></div></div>`);
  };

  /* Re-render once so the overlay is active after the base script has loaded. */
  if(sessionStorage.getItem(AUTH)==='admin')setTimeout(()=>render(),0);
})();
