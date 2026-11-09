(function stockCalculatorUI() {
  'use strict';
  const core = window.StockCalculatorCore;
  const state = {stock:null, orders:null, catalog:null, result:null, error:''};
  function safe(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[c]);
  }
  function count(v) { return Number(v || 0).toLocaleString('ru-RU'); }
  function tile(id,label,description) {
    const file = state[id];
    return `<label class="sc-upload" for="sc-file-${id}">
      <span class="sc-upload-icon" aria-hidden="true">⇧</span>
      <span class="sc-upload-label">${safe(label)}</span>
      <span class="sc-upload-description">${safe(description)}</span>
      <span class="sc-upload-file">${file ? safe(file.name) : 'Выбрать Excel-файл'}</span>
      <input type="file" id="sc-file-${id}" accept=".xlsx,.xls,.csv,.tsv" aria-label="${safe(label)}">
    </label>`;
  }
  function metric(title,value) {
    return `<div class="sc-metric"><span>${safe(title)}</span><strong>${count(value)}</strong></div>`;
  }
  function renderResult() {
    const r = state.result;
    if (!r) return '';
    const s = r.summary, ready = !r.unresolved.length;
    const preview = r.rows.slice(0,100);
    return `<section class="sc-panel" aria-label="Результат расчёта">
      <div class="sc-section-header"><h3>Результат</h3>
        <span class="sc-status ${ready ? 'sc-status-ok':'sc-status-error'}">${ready ? 'Сопоставление выполнено' : 'Нужен справочник'}</span>
      </div>
      <div class="sc-metrics">
        ${metric('На складе',s.stockTotal)}
        ${metric('Активных заказов',s.orderTotal)}
        ${metric('Вычтено',s.deductedTotal)}
        ${metric('Осталось',s.remainingTotal)}
      </div>
      <div class="sc-notes">
        <p>Позиции: ${count(s.stockPositions)} → ${count(s.remainingPositions)}. Нулевые остатки исключены из экспорта.</p>
        ${s.outsideTotal ? `<p class="sc-note">В заказах есть ${count(s.outsideTotal)} шт. по баркодам, отсутствующим в исходном остатке. Они не вычитались из других товаров.</p>` : ''}
        ${s.deficitTotal ? `<p class="sc-warning">Дефицит: ${count(s.deficitTotal)} шт. Для этих позиций итоговый остаток равен нулю, отрицательные значения не выгружаются.</p>` : ''}
        ${s.unresolvedTotal ? `<p class="sc-warning">Не определены баркоды для ${count(s.unresolvedTotal)} шт. Пока позиции не сопоставлены, выгрузка заблокирована.</p>` : ''}
      </div>
      ${r.unresolved.length ? `<div class="sc-report">
        <h4>Не найден баркод (${count(r.unresolved.length)} строк)</h4>
        <div class="sc-table-wrap"><table><thead><tr><th>Строка</th><th>Артикул</th><th>Размер</th><th>Шт.</th><th>Причина</th></tr></thead>
        <tbody>${r.unresolved.slice(0,50).map(x=>`<tr><td>${safe(x.row || '—')}</td><td>${safe(x.article || '—')}</td><td>${safe(x.size || '—')}</td><td>${count(x.quantity)}</td><td>${safe(x.reason)}</td></tr>`).join('')}</tbody></table></div>
        ${r.unresolved.length>50?`<small>Показаны первые 50 из ${count(r.unresolved.length)} ошибок.</small>`:''}
      </div>` : ''}
      ${r.deficits.length ? `<div class="sc-report">
        <h4>Недостаточно товара (${count(r.deficits.length)} поз.)</h4>
        <div class="sc-table-wrap"><table><thead><tr><th>Баркод</th><th>На складе</th><th>В заказах</th><th>Не хватает</th></tr></thead>
        <tbody>${r.deficits.slice(0,50).map(x=>`<tr><td>${safe(x.barcode)}</td><td>${count(x.available)}</td><td>${count(x.ordered)}</td><td>${count(x.shortage)}</td></tr>`).join('')}</tbody></table></div>
      </div>` : ''}
      <div class="sc-section-header"><h4>Предпросмотр итогового Excel</h4><span>Баркод · Количество</span></div>
      <div class="sc-table-wrap sc-preview"><table><thead><tr><th>Баркод</th><th>Количество</th></tr></thead>
      <tbody>${preview.length ? preview.map(x=>`<tr><td>${safe(x.barcode)}</td><td>${count(x.quantity)}</td></tr>`).join('') : '<tr><td colspan="2">Все остатки обнулены заказами.</td></tr>'}</tbody></table></div>
      ${r.rows.length>preview.length?`<small>Показаны первые ${count(preview.length)} из ${count(r.rows.length)} строк. В Excel попадут все.</small>`:''}
      <div class="sc-footer"><button id="sc-download" type="button" class="btn primary" ${ready?'':'disabled'}>↓ Скачать Excel — Баркод / Количество</button>
      ${ready ? '<span class="sc-muted">Расчёт не изменяет остатки в базе сайта.</span>' : '<span class="sc-warning">Загрузите корректный справочник и пересчитайте.</span>'}</div>
    </section>`;
  }
  window.stockCalculatorView = function stockCalculatorView() {
    return `<div class="sc-page">
      <div class="sc-intro"><div><div class="sc-eyebrow">Офис / Инструменты</div><h2>Калькулятор остатков</h2>
        <p>Загрузите текущие остатки и активные заказы (New). Калькулятор вычтет заказы по баркодам и подготовит Excel-файл.</p></div>
        <span class="sc-pill">Только расчёт · без списаний</span></div>
      <section class="sc-panel">
        <div class="sc-section-header"><h3>1. Загрузите два файла</h3><span>Excel · XLSX / XLS / CSV</span></div>
        <div class="sc-upload-grid">
          ${tile('stock','Остатки склада или офиса','Обязательные столбцы: Баркод, Количество')}
          ${tile('orders','Активные заказы New','Артикул продавца + Размер; при наличии — Баркод')}
        </div>
        <details class="sc-details" ${state.catalog?'open':''}>
          <summary>Дополнительно: загрузить справочник баркодов</summary>
          <p>Если товары отсутствуют в номенклатуре сайта, загрузите файл с колонками «Артикул продавца», «Размер», «Баркод». Для одинаковых позиций загруженный справочник имеет приоритет над данными сайта.</p>
          ${tile('catalog','Справочник номенклатуры','Необязательно: Артикул продавца / Размер / Баркод')}
          ${state.catalog?'<button type="button" class="btn" id="sc-clear-catalog">Убрать справочник</button>':''}
        </details>
        <div class="sc-footer">
          <button class="btn primary" id="sc-calculate" type="button" ${state.stock&&state.orders?'':'disabled'}>Рассчитать остатки</button>
          <span class="sc-muted">Используется номенклатура, загруженная в B-FBS. Файлы обрабатываются в браузере.</span>
        </div>
        ${state.error?`<div role="alert" class="sc-warning sc-error">${safe(state.error)}</div>`:''}
      </section>
      ${renderResult()}
    </div>`;
  };
  async function readRows(file, kind) {
    if (!window.XLSX) throw new Error('Библиотека Excel не загрузилась. Обновите страницу.');
    if (file.size>20*1024*1024) throw new Error('Размер каждого файла не должен превышать 20 МБ.');
    const data=await file.arrayBuffer();
    const wb=window.XLSX.read(data,{type:'array',cellDates:false});
    for (const name of wb.SheetNames) {
      const sh=wb.Sheets[name];
      if (!sh || !sh['!ref']) continue;
      const rows=window.XLSX.utils.sheet_to_json(sh,{header:1,raw:false,defval:''});
      try { core.identify(rows,kind); return rows; } catch (_) {}
    }
    throw new Error('В файле «'+file.name+'» нет листа с нужными колонками ('+
      (kind==='stock'?'Баркод, Количество':kind==='catalog'?'Артикул продавца, Размер, Баркод':'Артикул продавца, Размер либо Баркод')+').');
  }
  function siteNomenclature() {
    try {
      const data=JSON.parse(localStorage.getItem('b-fbs-wms-v1') || '{}');
      return Array.isArray(data.nomenclature)?data.nomenclature:[];
    } catch (_) { return []; }
  }
  function exportExcel() {
    const r=state.result;
    if (!r || r.unresolved.length) return;
    const data=[['Баркод','Количество'],...r.rows.map(x=>[String(x.barcode),x.quantity])];
    const sheet=window.XLSX.utils.aoa_to_sheet(data);
    sheet['!cols']=[{wch:24},{wch:16}];
    // Force barcode text cells so Excel does not reformat codes as numbers.
    for (let i=1;i<data.length;i++) {
      const cell=sheet[window.XLSX.utils.encode_cell({r:i,c:0})];
      if (cell) {cell.t='s';cell.v=String(data[i][0]);cell.z='@';}
    }
    const book=window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book,sheet,'Остатки');
    const date=new Date().toISOString().slice(0,10);
    window.XLSX.writeFile(book,'Остатки_за_вычетом_заказов_'+date+'.xlsx');
  }
  window.bindStockCalculator=function bindStockCalculator(){
    if (!document.getElementById('sc-calculate')) return;
    for (const id of ['stock','orders','catalog']) {
      const input=document.getElementById('sc-file-'+id);
      if (!input) continue;
      input.onchange=()=>{
        state[id]=input.files && input.files[0] || null;
        state.result=null;state.error='';
        window.render();
      };
    }
    document.getElementById('sc-clear-catalog')?.addEventListener('click',()=>{
      state.catalog=null;state.result=null;state.error='';window.render();
    });
    document.getElementById('sc-calculate').addEventListener('click',async event=>{
      const button=event.currentTarget;
      if (!state.stock || !state.orders) return;
      button.disabled=true;button.textContent='Обрабатываем Excel…';
      try {
        const [stockRows,orderRows,catalogRows]=await Promise.all([
          readRows(state.stock,'stock'),
          readRows(state.orders,'orders'),
          state.catalog ? readRows(state.catalog,'catalog') : Promise.resolve(null)
        ]);
        const stocks=core.parseStock(stockRows);
        const orders=core.parseOrders(orderRows);
        const catalog=catalogRows?core.parseCatalog(catalogRows):[];
        state.result=core.calculate(stocks,orders,siteNomenclature(),catalog);
        state.error='';
      } catch(error) {
        state.result=null;
        state.error=error?.message || 'Ошибка чтения файлов.';
      }
      window.render();
    });
    document.getElementById('sc-download')?.addEventListener('click',exportExcel);
  };
})();
