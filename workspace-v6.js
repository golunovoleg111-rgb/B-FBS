/* B-FBS Workspace v6.2 — published presentation and stable fullscreen layer. */
(function(){
  const originalRender = window.render;

  function isWorkspace(){ return activeTab === 'workspace'; }
  function isPublished(){ return isWorkspace() && workspaceMode === 'management' && !!published; }

  function enhance(){
    if(!isWorkspace()) return;
    const stage = document.getElementById('floor');
    const wrap = document.querySelector('.canvas-wrap');
    if(!stage || !wrap) return;

    const publishedMode = isPublished();
    stage.classList.toggle('published-mode', publishedMode);
    wrap.classList.toggle('published-mode', publishedMode);

    const svg = document.getElementById('warehouse-svg');
    if(svg){
      svg.setAttribute('preserveAspectRatio', publishedMode ? 'xMidYMid meet' : 'none');
      svg.querySelectorAll('.grid-line').forEach(el=>el.classList.toggle('published-hidden', publishedMode));
    }
    stage.querySelectorAll('.minimap').forEach(el=>el.classList.toggle('published-hidden', publishedMode));

    const controls = document.querySelector('.zoom-controls');
    if(!controls) return;

    const gridButton = document.getElementById('grid-toggle');
    if(gridButton) gridButton.hidden = publishedMode;

    let button = controls.querySelector('[data-fullscreen]');
    if(!button){
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.fullscreen = '1';
      button.className = 'fullscreen-control';
      controls.appendChild(button);

      button.addEventListener('click', async function(){
        try{
          if(document.fullscreenElement){
            await document.exitFullscreen();
            return;
          }
          await document.documentElement.requestFullscreen();
        }catch(err){
          console.warn('Fullscreen unavailable', err);
        }
      });
    }

    button.hidden = !publishedMode;
    button.textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'На полный экран';
  }

  document.addEventListener('fullscreenchange', function(){
    requestAnimationFrame(function(){
      enhance();
      if(document.fullscreenElement){
        const fit = document.getElementById('zoom-fit');
        if(fit) fit.click();
      }
    });
  });

  window.render = function(){
    if(typeof originalRender === 'function') originalRender();
    requestAnimationFrame(enhance);
  };

  if(typeof originalRender === 'function') window.render();
})();
