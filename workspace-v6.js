/* B-FBS Workspace v6.1 — published presentation and fullscreen layer. */
(function(){
  const originalRender = window.render;

  // app.js declares these with top-level `let`. They are available to later
  // classic scripts, but are intentionally not properties of `window`.
  function isWorkspace(){
    return activeTab === 'workspace';
  }

  function isPublished(){
    return isWorkspace() && workspaceMode === 'management' && !!published;
  }

  function hidePublishedEditorChrome(stage){
    if(!stage) return;
    stage.querySelectorAll('.grid-line, .minimap').forEach(el=>el.classList.add('published-hidden'));
  }

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
      if(publishedMode){
        svg.querySelectorAll('.grid-line').forEach(el=>el.classList.add('published-hidden'));
      }
    }

    if(publishedMode) hidePublishedEditorChrome(stage);

    const controls = document.querySelector('.zoom-controls');
    if(!controls) return;

    let button = controls.querySelector('[data-fullscreen]');
    if(!button){
      button = document.createElement('button');
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
            }, 150);
          }else{
            await document.exitFullscreen();
          }
        }catch(err){
          console.warn('Fullscreen unavailable', err);
        }
      });
    }

    button.hidden = !publishedMode;
  }

  document.addEventListener('fullscreenchange', function(){
    const stage = document.getElementById('floor');
    if(!stage) return;
    const active = document.fullscreenElement === stage;
    stage.classList.toggle('is-fullscreen', active);

    if(active){
      setTimeout(function(){
        const fit = document.getElementById('zoom-fit');
        if(fit) fit.click();
      }, 150);
    }
  });

  window.render = function(){
    if(typeof originalRender === 'function') originalRender();
    requestAnimationFrame(enhance);
  };

  if(typeof originalRender === 'function') window.render();
})();
