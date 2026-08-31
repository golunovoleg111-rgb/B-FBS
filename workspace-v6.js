/* B-FBS Workspace v6.3 — internal presentation mode. */
(function(){
  const originalRender = window.render;
  let presentationMode = false;

  function isWorkspace(){ return activeTab === 'workspace'; }
  function isPublished(){ return isWorkspace() && workspaceMode === 'management' && !!published; }

  function fitMap(){
    requestAnimationFrame(function(){
      const fit = document.getElementById('zoom-fit');
      if(fit) fit.click();
    });
  }

  function setPresentation(enabled){
    presentationMode = !!enabled;
    document.body.classList.toggle('presentation-mode', presentationMode);
    const stage = document.getElementById('floor');
    if(stage) stage.classList.toggle('presentation-mode', presentationMode);
    if(presentationMode) fitMap();
  }

  function enhance(){
    if(!isWorkspace()){
      setPresentation(false);
      return;
    }

    const stage = document.getElementById('floor');
    const wrap = document.querySelector('.canvas-wrap');
    if(!stage || !wrap) return;

    const publishedMode = isPublished();
    stage.classList.toggle('published-mode', publishedMode);
    wrap.classList.toggle('published-mode', publishedMode);

    if(!publishedMode && presentationMode) setPresentation(false);

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

    let button = controls.querySelector('[data-presentation]');
    if(!button){
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.presentation = '1';
      button.className = 'fullscreen-control';
      controls.appendChild(button);
      button.addEventListener('click', function(){
        if(!isPublished()) return;
        setPresentation(!presentationMode);
      });
    }

    button.hidden = !publishedMode || presentationMode;
    button.textContent = presentationMode ? 'Выйти из полного экрана' : 'На полный экран';
  }

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape' && presentationMode){
      event.preventDefault();
      setPresentation(false);
      requestAnimationFrame(enhance);
    }
  });

  window.render = function(){
    if(typeof originalRender === 'function') originalRender();
    requestAnimationFrame(enhance);
  };

  if(typeof originalRender === 'function') window.render();
})();
