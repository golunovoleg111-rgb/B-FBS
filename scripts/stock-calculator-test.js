(function stockCalculatorTests() {
  'use strict';
  const assert = require('node:assert/strict');
  const C = require('../stock-calculator-core.js');
  const stock = C.parseStock([
    ['Баркод','Количество'],
    ['001234',6],['001234',4],['998877',2],['333222',0]
  ]);
  assert.deepEqual(stock,[
    {barcode:'001234',quantity:10},
    {barcode:'998877',quantity:2},
    {barcode:'333222',quantity:0}
  ],'duplicate stock rows must be aggregated without losing barcode strings');
  const orders=C.parseOrders([
    ['№ задания','Размер','Баркод','Артикул продавца','Статус задания'],
    ['123','44','','ART_1','Новое'],
    ['124','44','','ART_1','Новое'],
    ['125','52','112233','ART_2','Новое']
  ]);
  assert.equal(orders.length,3);
  assert.equal(orders[0].quantity,1,'each New row represents one item by default');
  const ref=C.parseCatalog([
    ['Артикул продавца','Размер','Баркод'],
    ['ART_1','44','001234'],
    ['ART_2','52','112233']
  ]);
  const a=C.calculate(stock,orders,[],ref);
  assert.equal(a.summary.stockTotal,12);
  assert.equal(a.summary.orderTotal,3);
  assert.equal(a.summary.deductedTotal,2);
  assert.equal(a.summary.outsideTotal,1,'orders absent from this stock should not reduce another SKU');
  assert.equal(a.summary.remainingTotal,10);
  assert.deepEqual(a.rows,[{barcode:'001234',quantity:8},{barcode:'998877',quantity:2}]);
  assert.equal(a.unresolved.length,0);
  const tooMany=C.calculate([{barcode:'Z',quantity:1}],
    [{barcode:'Z',article:'',size:'',quantity:3}],[],[]);
  assert.equal(tooMany.summary.deductedTotal,1);
  assert.equal(tooMany.summary.deficitTotal,2);
  assert.deepEqual(tooMany.rows,[],'negative stock must not appear');
  const missing=C.calculate(stock,[{article:'UNKNOWN',size:'46',quantity:2,row:8,barcode:''}],[],[]);
  assert.equal(missing.summary.unresolvedTotal,2);
  assert.equal(missing.unresolved[0].row,8);
  const ambiguity=C.calculate(stock,[{article:'A',size:'44',barcode:'',quantity:1}],
    [{article:'A',size:'44',barcode:'001234'},{article:'A',size:'44',barcode:'998877'}],[]);
  assert.equal(ambiguity.unresolved.length,1,'ambiguous article+size must not be guessed');
  const uploadWins=C.calculate(stock,[{article:'A',size:'44',barcode:'',quantity:1}],
    [{article:'A',size:'44',barcode:'998877'}],
    [{article:'A',size:'44',barcode:'001234'}]);
  assert.equal(uploadWins.summary.deductedTotal,1);
  assert.equal(uploadWins.rows.find(item=>item.barcode==='001234').quantity,9);
  assert.throws(()=>C.parseStock([['Баркод','Количество'],['1',-2]]),/Некорректное количество/);
  assert.throws(()=>C.parseStock([['Баркод','Количество'],['',2]]),/отсутствует баркод/);
  assert.throws(()=>C.parseOrders([['Артикул продавца','Размер','Количество'],['A','44','1.5']]),/Некорректное количество/);
  console.log('Stock calculator: all assertions passed');
})();
