/* B-FBS UI System v2 — motion and boot presentation only. */
(function(){
  'use strict';

  const loader=document.getElementById('app-loader');
  const started=performance.now();

  function hideLoader(){
    if(!loader)return;
    const wait=Math.max(0,520-(performance.now()-started));
    setTimeout(function(){
      loader.classList.add('is-hidden');
      document.documentElement.classList.add('ui-ready');
      setTimeout(function(){loader.remove()},460);
    },wait);
  }

  if(document.readyState==='complete')hideLoader();
  else window.addEventListener('load',hideLoader,{once:true});

  const root=document.getElementById('root');
  if(!root)return;

  let frame=0;
  function enhance(){
    frame=0;
    const page=document.querySelector('.content > *');
    if(page&&!page.dataset.uiEntered){
      page.dataset.uiEntered='1';
      page.classList.remove('ui-page-enter');
      requestAnimationFrame(function(){page.classList.add('ui-page-enter')});
    }
  }

  const observer=new MutationObserver(function(){
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(enhance);
  });
  observer.observe(root,{childList:true,subtree:true});
  enhance();
})();
