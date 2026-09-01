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
  let lastPageKey='';
  let openSelectState=null;

  function pageKey(page){
    if(typeof activeTab!=='undefined')return String(activeTab);
    return page?.className||'page';
  }

  function closeSelect(){
    if(!openSelectState)return;
    openSelectState.trigger.classList.remove('is-open');
    openSelectState.trigger.setAttribute('aria-expanded','false');
    openSelectState.menu.remove();
    openSelectState=null;
  }

  function selectedText(select){
    return select.options[select.selectedIndex]?.textContent?.trim()||'Выберите';
  }

  function syncSelect(select){
    const wrapper=select.nextElementSibling;
    const trigger=wrapper?.classList?.contains('ui-select')?wrapper.querySelector('.ui-select-trigger'):null;
    if(!trigger)return;
    trigger.querySelector('.ui-select-value').textContent=selectedText(select);
    trigger.disabled=select.disabled;
  }

  function openSelect(select,trigger){
    if(openSelectState?.select===select){closeSelect();return}
    closeSelect();

    const menu=document.createElement('div');
    menu.className='ui-select-menu';
    menu.setAttribute('role','listbox');

    [...select.options].forEach(option=>{
      const item=document.createElement('button');
      item.type='button';
      item.className='ui-select-option';
      item.dataset.value=option.value;
      item.textContent=option.textContent;
      item.disabled=option.disabled;
      item.classList.toggle('selected',option.selected);
      item.setAttribute('role','option');
      item.setAttribute('aria-selected',String(option.selected));
      item.addEventListener('click',()=>{
        if(option.disabled)return;
        select.value=option.value;
        select.dispatchEvent(new Event('input',{bubbles:true}));
        select.dispatchEvent(new Event('change',{bubbles:true}));
        syncSelect(select);
        closeSelect();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    const rect=trigger.getBoundingClientRect();
    const width=Math.max(180,rect.width);
    const estimated=Math.min(300,Math.max(52,select.options.length*38+10));
    const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left));
    const placeAbove=rect.bottom+estimated+8>window.innerHeight&&rect.top>estimated+8;
    const top=placeAbove?Math.max(8,rect.top-estimated-6):Math.min(window.innerHeight-estimated-8,rect.bottom+6);

    menu.style.width=`${width}px`;
    menu.style.left=`${left}px`;
    menu.style.top=`${top}px`;

    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded','true');
    openSelectState={select,trigger,menu};
    requestAnimationFrame(()=>menu.classList.add('is-visible'));
  }

  function enhanceSelect(select){
    if(select.multiple||select.dataset.uiSelect==='1')return;
    select.dataset.uiSelect='1';
    select.classList.add('ui-native-select');
    select.tabIndex=-1;

    const wrapper=document.createElement('div');
    wrapper.className='ui-select';

    const trigger=document.createElement('button');
    trigger.type='button';
    trigger.className='ui-select-trigger';
    trigger.setAttribute('aria-haspopup','listbox');
    trigger.setAttribute('aria-expanded','false');
    trigger.innerHTML='<span class="ui-select-value"></span><span class="ui-select-chevron" aria-hidden="true"></span>';

    wrapper.appendChild(trigger);
    select.insertAdjacentElement('afterend',wrapper);

    trigger.addEventListener('click',()=>{if(!select.disabled)openSelect(select,trigger)});
    trigger.addEventListener('keydown',event=>{
      if(event.key==='Escape'){closeSelect();return}
      if(event.key==='ArrowDown'||event.key==='Enter'||event.key===' '){
        event.preventDefault();
        if(!select.disabled)openSelect(select,trigger);
      }
    });
    select.addEventListener('change',()=>syncSelect(select));
    syncSelect(select);
  }

  function enhanceSelects(){
    document.querySelectorAll('select:not([multiple])').forEach(select=>{
      if(!select.isConnected)return;
      if(select.dataset.uiSelect!=='1')enhanceSelect(select);
      else syncSelect(select);
    });
    if(openSelectState&&!openSelectState.select.isConnected)closeSelect();
  }

  function enhance(){
    frame=0;
    const page=document.querySelector('.content > *');
    const key=pageKey(page);
    if(page&&key!==lastPageKey){
      lastPageKey=key;
      page.classList.remove('ui-page-enter');
      requestAnimationFrame(function(){page.classList.add('ui-page-enter')});
    }
    enhanceSelects();
  }

  const observer=new MutationObserver(function(){
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(enhance);
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});

  document.addEventListener('pointerdown',event=>{
    if(!openSelectState)return;
    if(event.target.closest('.ui-select-menu')||event.target.closest('.ui-select-trigger')===openSelectState.trigger)return;
    closeSelect();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSelect()});
  window.addEventListener('resize',closeSelect);
  window.addEventListener('scroll',closeSelect,true);
  enhance();
})();
