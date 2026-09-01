/* B-FBS Workspace v6.4 — stable published view and internal presentation mode. */
(function(){
  const originalRender = window.render;
  const originalFloorPoint = window.floorPoint;
  const originalClampPan = window.clampPan;
  const originalSetZoom = window.setZoom;
  const originalFitView = window.fitView;
  const originalUpdateCanvas = window.updateCanvas;
  const originalPointerMove = window.onPointerMove;
  const originalPointerUp = window.onPointerUp;

  window.__bfbsPublishedViewportController = 'wall-bounds-v1';

  let presentationMode = false;
  let lastPublishedSource = null;
  let lastViewport = null;
  let resizeFrame = 0;

  function isWorkspace(){ return activeTab === 'workspace'; }
  function isPublished(){ return isWorkspace() && workspaceMode === 'management' && !!published; }
  function stageElement(){ return document.getElementById('floor'); }

  function publishedBounds(){
    const walls = published?.walls;
    if(!walls?.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    walls.forEach(function(wall){
      if(wall.type === 'line'){
        minX = Math.min(minX, wall.x1, wall.x2);
        minY = Math.min(minY, wall.y1, wall.y2);
        maxX = Math.max(maxX, wall.x1, wall.x2);
        maxY = Math.max(maxY, wall.y1, wall.y2);
      }else{
        minX = Math.min(minX, wall.x);
        minY = Math.min(minY, wall.y);
        maxX = Math.max(maxX, wall.x + wall.w);
        maxY = Math.max(maxY, wall.y + wall.h);
      }
    });
    return {minX, minY, maxX, maxY};
  }

  function publishedViewport(zoomValue = view.zoom){
    const stage = stageElement();
    const rect = stage?.getBoundingClientRect();
    const pixelWidth = Math.max(1, rect?.width || VIEW.w);
    const pixelHeight = Math.max(1, rect?.height || VIEW.h);
    const baseWidth = VIEW.w;
    const baseHeight = baseWidth * pixelHeight / pixelWidth;
    return {w:baseWidth / zoomValue, h:baseHeight / zoomValue};
  }

  function publishedDisplayBounds(){
    const bounds = publishedBounds();
    if(!bounds) return null;
    // Small gutter keeps the outer wall stroke fully visible while the walls
    // remain the hard navigation boundary of the published map.
    const gutter = 14;
    return {
      minX:bounds.minX-gutter,
      minY:bounds.minY-gutter,
      maxX:bounds.maxX+gutter,
      maxY:bounds.maxY+gutter
    };
  }

  function publishedFitZoom(){
    const bounds = publishedDisplayBounds();
    if(!bounds) return 1;
    const stage = stageElement();
    const rect = stage?.getBoundingClientRect();
    const pixelWidth = Math.max(1, rect?.width || VIEW.w);
    const pixelHeight = Math.max(1, rect?.height || VIEW.h);
    const baseWidth = VIEW.w;
    const baseHeight = baseWidth * pixelHeight / pixelWidth;
    const width = Math.max(1,bounds.maxX-bounds.minX);
    const height = Math.max(1,bounds.maxY-bounds.minY);
    return Math.max(ZOOM.min,Math.min(ZOOM.max,Math.min(baseWidth/width,baseHeight/height)));
  }

  function updateZoomReadout(){
    const value = `${Math.round(view.zoom * 100)}%`;
    const status = document.querySelector('.editor-status');
    if(status) status.textContent = `Масштаб ${value} · опубликованная схема`;
    const readout = document.querySelector('.zoom-controls span');
    if(readout) readout.textContent = value;
  }

  function syncPublishedCanvas(){
    const svg = document.getElementById('warehouse-svg');
    if(!svg) return;
    const viewport = publishedViewport();
    svg.setAttribute('viewBox', `${view.panX} ${view.panY} ${viewport.w} ${viewport.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    lastViewport = viewport;
    updateZoomReadout();
  }

  function clampPublishedPan(){
    const bounds = publishedDisplayBounds();
    if(!bounds){
      view.panX = 0;
      view.panY = 0;
      return;
    }
    const viewport = publishedViewport();
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;

    // At fit scale an axis may be wider than the warehouse because the screen
    // aspect ratio differs from the wall rectangle. That axis stays centered.
    // Once zoomed in, panning is free until the outer walls reach the viewport.
    view.panX = viewport.w >= width
      ? bounds.minX - (viewport.w - width) / 2
      : Math.max(bounds.minX, Math.min(bounds.maxX - viewport.w, view.panX));
    view.panY = viewport.h >= height
      ? bounds.minY - (viewport.h - height) / 2
      : Math.max(bounds.minY, Math.min(bounds.maxY - viewport.h, view.panY));
  }

  window.floorPoint = function(event){
    if(!isPublished()) return originalFloorPoint(event);
    const stage = stageElement();
    const rect = stage?.getBoundingClientRect();
    if(!rect?.width || !rect?.height) return originalFloorPoint(event);
    const viewport = publishedViewport();
    return {
      x:view.panX + (event.clientX - rect.left) / rect.width * viewport.w,
      y:view.panY + (event.clientY - rect.top) / rect.height * viewport.h
    };
  };

  window.clampPan = function(){
    if(!isPublished()) return originalClampPan();
    clampPublishedPan();
  };

  window.setZoom = function(nextZoom, anchor){
    if(!isPublished()) return originalSetZoom(nextZoom, anchor);
    const oldZoom = view.zoom;
    const minZoom = publishedFitZoom();
    const normalized = Math.max(minZoom, Math.min(ZOOM.max, Math.round(nextZoom * 10) / 10));
    if(Math.abs(normalized-oldZoom)<0.0001) return;

    const oldViewport = publishedViewport(oldZoom);
    const focus = anchor || {
      x:view.panX + oldViewport.w / 2,
      y:view.panY + oldViewport.h / 2
    };
    const ratioX = (focus.x - view.panX) / oldViewport.w;
    const ratioY = (focus.y - view.panY) / oldViewport.h;

    view.zoom = normalized;
    const nextViewport = publishedViewport(normalized);
    view.panX = focus.x - ratioX * nextViewport.w;
    view.panY = focus.y - ratioY * nextViewport.h;
    clampPublishedPan();
    syncPublishedCanvas();
    persist();
  };

  window.fitView = function(){
    if(!isPublished()) return originalFitView();
    const bounds = publishedDisplayBounds();
    if(!bounds){
      view.zoom = 1;
      view.panX = 0;
      view.panY = 0;
      syncPublishedCanvas();
      return;
    }

    view.zoom = publishedFitZoom();
    const viewport = publishedViewport();
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    view.panX = bounds.minX - (viewport.w - width) / 2;
    view.panY = bounds.minY - (viewport.h - height) / 2;
    clampPublishedPan();
    syncPublishedCanvas();
    persist();
  };

  window.updateCanvas = function(){
    if(!isPublished()) return originalUpdateCanvas();
    syncPublishedCanvas();
  };

  window.onPointerMove = function(event){
    if(!isPublished() || pointerAction !== 'pan') return originalPointerMove(event);
    const stage = stageElement();
    const rect = stage?.getBoundingClientRect();
    if(!rect?.width || !rect?.height) return;
    const viewport = publishedViewport();
    view.panX = dragStart.panX - (event.clientX - dragStart.x) / rect.width * viewport.w;
    view.panY = dragStart.panY - (event.clientY - dragStart.y) / rect.height * viewport.h;
    clampPublishedPan();
    syncPublishedCanvas();
  };

  window.onPointerUp = function(event){
    if(!isPublished() || pointerAction !== 'pan') return originalPointerUp(event);
    pointerAction = null;
    event.currentTarget.classList.remove('panning');
    try{ event.currentTarget.releasePointerCapture(event.pointerId); }catch(_){}
    // Do not re-render the whole application after a camera drag. A full
    // render used to run the legacy clamp and visually "snap" the warehouse.
    persist();
    syncPublishedCanvas();
  };

  function setPresentation(enabled){
    const next = !!enabled && isPublished();
    if(next === presentationMode) return;

    const previousViewport = isPublished() ? publishedViewport() : null;
    const center = previousViewport ? {
      x:view.panX + previousViewport.w / 2,
      y:view.panY + previousViewport.h / 2
    } : null;

    presentationMode = next;
    document.body.classList.toggle('presentation-mode', presentationMode);
    stageElement()?.classList.toggle('presentation-mode', presentationMode);

    requestAnimationFrame(function(){
      if(!isPublished()) return;
      if(presentationMode){
        window.fitView();
      }else if(center){
        const viewport = publishedViewport();
        view.panX = center.x - viewport.w / 2;
        view.panY = center.y - viewport.h / 2;
        clampPublishedPan();
        syncPublishedCanvas();
        enhance();
      }
    });
  }

  function enhance(){
    if(!isWorkspace()){
      if(presentationMode) setPresentation(false);
      return;
    }

    const stage = stageElement();
    const wrap = document.querySelector('.canvas-wrap');
    if(!stage || !wrap) return;

    const publishedMode = isPublished();
    const sourceChanged = publishedMode && published !== lastPublishedSource;
    lastPublishedSource = publishedMode ? published : null;

    stage.classList.toggle('published-mode', publishedMode);
    stage.classList.toggle('presentation-mode', presentationMode && publishedMode);
    wrap.classList.toggle('published-mode', publishedMode);
    document.body.classList.toggle('presentation-mode', presentationMode && publishedMode);

    if(!publishedMode && presentationMode){
      setPresentation(false);
      return;
    }

    const svg = document.getElementById('warehouse-svg');
    if(svg){
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.querySelectorAll('.grid-line').forEach(el=>el.classList.toggle('published-hidden', publishedMode));
    }
    stage.querySelectorAll('.minimap').forEach(el=>el.classList.toggle('published-hidden', publishedMode));

    const controls = document.querySelector('.zoom-controls');
    if(!controls) return;

    ['grid-toggle', 'snap-toggle', 'undo-btn', 'redo-btn'].forEach(function(id){
      const control = document.getElementById(id);
      if(control) control.hidden = publishedMode;
    });

    let button = controls.querySelector('[data-presentation]');
    if(!button){
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.presentation = '1';
      button.className = 'fullscreen-control';
      button.addEventListener('click', function(){
        if(isPublished()) setPresentation(!presentationMode);
      });
      controls.appendChild(button);
    }

    button.hidden = !publishedMode || presentationMode;
    button.textContent = 'На полный экран';
    button.setAttribute('aria-pressed', String(presentationMode));

    if(publishedMode){
      requestAnimationFrame(function(){
        const needsFit=!!window.__bfbsWorkspaceNeedsFit;
        const minZoom=publishedFitZoom();
        if(sourceChanged && !presentationMode && needsFit){
          window.__bfbsWorkspaceNeedsFit=false;
          window.fitView();
        }else{
          if(view.zoom<minZoom)view.zoom=minZoom;
          clampPublishedPan();
          syncPublishedCanvas();
        }
      });
    }
  }

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape' && presentationMode){
      event.preventDefault();
      setPresentation(false);
    }
  });

  window.addEventListener('resize', function(){
    if(!isPublished()) return;
    const previous = lastViewport || publishedViewport();
    const center = {
      x:view.panX + previous.w / 2,
      y:view.panY + previous.h / 2
    };
    if(resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function(){
      resizeFrame = 0;
      if(!isPublished()) return;
      const viewport = publishedViewport();
      view.panX = center.x - viewport.w / 2;
      view.panY = center.y - viewport.h / 2;
      clampPublishedPan();
      syncPublishedCanvas();
    });
  }, true);

  window.render = function(){
    if(typeof originalRender === 'function') originalRender();
    requestAnimationFrame(enhance);
  };

  if(typeof originalRender === 'function') window.render();
})();

