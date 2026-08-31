/* B-FBS Workspace v6 — published presentation and fullscreen layer. */
(function(){
  const originalRender = window.render;

  function isPublished(){
    return window.activeTab === 'workspace' && window.workspaceMode === 'management' && !!window.published;
  }

  function enhance(){
    if(window.activeTab !== 'workspace') return;
    const stage = document.getElementById('floor');
    const wrap = document.querySelector('.canvas-wrap');
    if(!stage || !wrap) return;

    const published = isPublished();
    stage.classList.toggle('published-mode', published);
    wrap.classList.toggle('published-mode', published);

    const svg = document.getElementById('warehouse-svg');
    if(svg){
      // Editing keeps the existing coordinate behaviour. Published mode is a
      // presentation view, so preserve the warehouse aspect ratio.
      svg.setAttribute('preserveAspectRatio', published ? 'xMidYMid meet' : 'none');
    }

    if(published){
      const minimap = stage.querySelector('.minimap');
      if(minimap) minimap.classList.add('published-hidden');
    }

    const controls = document.querySelector('.zoom-controls');
    if(!controls || controls.querySelector('[data-fullscreen]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.fullscreen = '1';
    button.textContent = 'На полный экран';
    button.title = 'Показать карту склада на весь экран';
    controls.appendChild(button);

    button.addEventListener('click', async function(){
      try{
        if(!document.fullscreenElement){
          await stage.requestFullscreen();
          setTimeout(function(){
            const fit = document.getElementById('zoom-fit');
            if(fit) fit.click();
          }, 120);
        }else{
          await document.exitFullscreen();
        }
      }catch(err){
        console.warn('Fullscreen unavailable', err);
      }
    });
  }

  document.addEventListener('fullscreenchange', function(){
    const stage=document.getElementById('floor');
    if(!stage) return;
    stage.classList.toggle('is-fullscreen', !!document.fullscreenElement);
    if(document.fullscreenElement===stage){
      setTimeout(function(){
        const fit=document.getElementById('zoom-fit');
        if(fit) fit.click();
      },120);
    }
  });

  window.render=function(){
    if(typeof originalRender==='function') originalRender();
    requestAnimationFrame(enhance);
  };

  if(typeof originalRender==='function') window.render();
})();
