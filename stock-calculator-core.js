(function stockCalculatorModule(root) {
  'use strict';
  const BARCODE_HEADERS = ['баркод','баркодтовара','штрихкод','штрихкодтовара','шк','штрихкодизделия','barcode','ean','ean13','sku'];
  const QTY_HEADERS = ['количество','количествошт','остаток','остатки','остатокшт','qty','quantity','колвошт','колво','фактическоеколичество'];
  const ARTICLE_HEADERS = ['артикулпродавца','артикул','vendorcode','артикултовара','артикулпоставщика'];
  const SIZE_HEADERS = ['размер','размертовара','размеризделия','techsize','wbsize'];
  function header(value) {
    return String(value == null ? '' : value).toLocaleLowerCase('ru-RU').replace(/[\s\u00a0_.()\-\/:,№]/g, '');
  }
  function text(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim();
  }
  function barcode(value) {
    return text(value).replace(/\.0$/, '');
  }
  function key(article, size) {
    return text(article).toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ') + '\u0001' +
      text(size).toLocaleLowerCase('ru-RU').replace(/\s+/g, '');
  }
  function findColumn(cells, aliases) {
    return cells.findIndex(cell => aliases.includes(header(cell)));
  }
  function identify(rows, type) {
    if (!Array.isArray(rows)) throw new Error('Не удалось прочитать строки Excel.');
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const cells = Array.isArray(rows[i]) ? rows[i] : [];
      const b = findColumn(cells, BARCODE_HEADERS);
      const q = findColumn(cells, QTY_HEADERS);
      const a = findColumn(cells, ARTICLE_HEADERS);
      const s = findColumn(cells, SIZE_HEADERS);
      if ((type === 'stock' && b >= 0 && q >= 0) ||
          (type === 'orders' && (b >= 0 || (a >= 0 && s >= 0))) ||
          (type === 'catalog' && b >= 0 && a >= 0 && s >= 0)) {
        return {row:i, barcode:b, quantity:q, article:a, size:s};
      }
    }
    const expected = type === 'stock' ? 'Баркод и Количество' :
      type === 'catalog' ? 'Артикул продавца, Размер и Баркод' :
      'Баркод либо Артикул продавца и Размер';
    throw new Error('Не найдены колонки: ' + expected + '.');
  }
  function quantity(value, row) {
    const raw = text(value).replace(/\s+/g, '').replace(',', '.');
    const n = raw === '' ? NaN : Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new Error('Некорректное количество в строке ' + row + ': «' + text(value) + '».');
    }
    return n;
  }
  function parseStock(rows) {
    const c = identify(rows, 'stock');
    const map = new Map();
    for (let i = c.row + 1; i < rows.length; i++) {
      const line = rows[i] || [];
      const b = barcode(line[c.barcode]);
      const qValue = line[c.quantity];
      if (!b && !text(qValue)) continue;
      if (!b) throw new Error('В остатках отсутствует баркод, строка ' + (i + 1) + '.');
      const q = quantity(qValue, i + 1);
      const next = (map.get(b) || 0) + q;
      if (!Number.isSafeInteger(next)) throw new Error('Слишком большое количество для баркода ' + b + '.');
      map.set(b, next);
    }
    if (!map.size) throw new Error('В файле остатков нет позиций.');
    return [...map].map(([barcode, quantity]) => ({barcode, quantity}));
  }
  function parseOrders(rows) {
    const c = identify(rows, 'orders');
    const orders = [];
    for (let i = c.row + 1; i < rows.length; i++) {
      const line = rows[i] || [];
      const b = c.barcode < 0 ? '' : barcode(line[c.barcode]);
      const a = c.article < 0 ? '' : text(line[c.article]);
      const s = c.size < 0 ? '' : text(line[c.size]);
      if (!b && !a && !s) {
        if (c.quantity >= 0 && text(line[c.quantity])) {
          throw new Error('Не определён товар в строке заказов ' + (i + 1) + '.');
        }
        continue;
      }
      const q = c.quantity >= 0 ? quantity(line[c.quantity], i + 1) : 1;
      if (!q) continue;
      orders.push({barcode:b, article:a, size:s, quantity:q, row:i + 1});
    }
    if (!orders.length) throw new Error('В файле активных заказов нет позиций.');
    return orders;
  }
  function parseCatalog(rows) {
    const c = identify(rows, 'catalog');
    const entries = [];
    for (let i = c.row + 1; i < rows.length; i++) {
      const line = rows[i] || [];
      const a = text(line[c.article]), s = text(line[c.size]), b = barcode(line[c.barcode]);
      if (!a && !s && !b) continue;
      if (!a || !s || !b) throw new Error('Незаполненная позиция справочника, строка ' + (i + 1) + '.');
      entries.push({article:a, size:s, barcode:b});
    }
    return entries;
  }
  function catalogMap(entries) {
    const map = new Map();
    for (const item of entries || []) {
      const a = text(item.article), s = text(item.size), b = barcode(item.barcode);
      if (!a || !s || !b) continue;
      const k = key(a,s);
      if (!map.has(k)) map.set(k,new Set());
      map.get(k).add(b);
    }
    return map;
  }
  function calculate(stock, orders, siteCatalog, uploadedCatalog) {
    const byStock = new Map(stock.map(item => [barcode(item.barcode), Number(item.quantity)]));
    const siteMap = catalogMap(siteCatalog);
    const uploadMap = catalogMap(uploadedCatalog);
    const orderByBarcode = new Map();
    const unresolved = [];
    let orderTotal = 0, unresolvedTotal = 0;
    for (const order of orders) {
      const q = Number(order.quantity);
      if (!Number.isSafeInteger(q) || q < 0) throw new Error('Некорректное количество в заказах.');
      orderTotal += q;
      let b = barcode(order.barcode);
      if (!b) {
        const a = text(order.article), s = text(order.size);
        const k = key(a,s);
        const candidates = uploadMap.get(k) || siteMap.get(k);
        if (!a || !s || !candidates || candidates.size !== 1) {
          unresolved.push({
            article:a, size:s, quantity:q, row:order.row,
            reason:!a || !s ? 'Отсутствует артикул или размер' :
              !candidates ? 'Нет баркода в справочнике' : 'Несколько баркодов для одного артикула и размера'
          });
          unresolvedTotal += q;
          continue;
        }
        b = [...candidates][0];
      }
      orderByBarcode.set(b,(orderByBarcode.get(b) || 0) + q);
    }
    const result = [];
    const deficits = [];
    let stockTotal = 0, deductedTotal = 0, outsideTotal = 0, deficitTotal = 0;
    for (const item of stock) {
      const b = barcode(item.barcode), available = Number(item.quantity), ordered = orderByBarcode.get(b) || 0;
      stockTotal += available;
      const deducted = Math.min(available,ordered);
      deductedTotal += deducted;
      const remain = available - deducted;
      if (remain > 0) result.push({barcode:b, quantity:remain});
      if (ordered > available) {
        const shortage = ordered - available;
        deficitTotal += shortage;
        deficits.push({barcode:b, available, ordered, shortage});
      }
    }
    for (const [b,q] of orderByBarcode) if (!byStock.has(b)) outsideTotal += q;
    return {
      rows:result, unresolved, deficits,
      summary:{
        stockTotal, orderTotal, accountedTotal:orderTotal - unresolvedTotal,
        deductedTotal, outsideTotal, deficitTotal, unresolvedTotal,
        remainingTotal:stockTotal - deductedTotal,
        stockPositions:stock.length, remainingPositions:result.length
      }
    };
  }
  const api = {identify, parseStock, parseOrders, parseCatalog, calculate, barcode, key};
  root.StockCalculatorCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
