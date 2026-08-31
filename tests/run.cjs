#!/usr/bin/env node
/**
 * Регрессионные проверки ядра: подбор товара и выбор цены.
 *
 * Зависимостей нет намеренно — config/query/pick это чистые функции над
 * строками и числами, им не нужен ни браузер, ни DOM. Загружаем их так же,
 * как это делает service worker: скрипты вешают себя на globalThis.TC.
 */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
for (const file of ['src/config.js', 'src/query.js', 'src/pick.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
}
const TC = globalThis.TC;

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}\n          ожидали ${e}\n          получили ${a}`);
  }
}

function ok(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n── Характеристики на кириллице');
// В JavaScript граница слова \b считается только по латинице, поэтому /мАч\b/
// не срабатывает никогда. Если это сломать заново — вся сверка характеристик
// на русских названиях умрёт молча, и товары начнут «совпадать» ошибочно.
check('«20000 мАч» распознаётся', TC.parseSpecs('Внешний аккумулятор 20000 мАч быстрая зарядка'), { mah: 20000 });
check('«128 ГБ» распознаётся', TC.parseSpecs('iPhone 15 128 ГБ'), { gb: 128 });
ok('20000 мАч конфликтует с 10000 мАч',
  TC.specConflict(TC.parseSpecs('Повербанк 20000 мАч'), TC.parseSpecs('Повербанк 10000 мАч'))?.hard === true,
  'разная ёмкость обязана быть жёстким расхождением');
ok('1 ТБ конфликтует с 512 ГБ',
  TC.specConflict(TC.parseSpecs('SSD 1 ТБ'), TC.parseSpecs('SSD 512 ГБ'))?.hard === true,
  'единицы не должны скрывать разный объём памяти');
check('1 ТБ эквивалентен 1024 ГБ',
  TC.specConflict(TC.parseSpecs('SSD 1 ТБ'), TC.parseSpecs('SSD 1024 ГБ')), null);
check('1 ТБ эквивалентен маркетинговым 1000 ГБ',
  TC.specConflict(TC.parseSpecs('SSD 1 ТБ'), TC.parseSpecs('SSD 1000 ГБ')), null);

console.log('\n── Запрос из названия-ключевика');
const jbl = TC.buildQuery('Наушники беспроводные JBL Tune 520BT накладные Bluetooth с микрофоном чёрные', 'JBL');
check('из мусорного названия остаётся суть', jbl.text, 'jbl tune 520bt');
ok('код модели попал в обязательные слова', jbl.must.includes('520bt'), JSON.stringify(jbl.must));

const galaxyS10 = TC.buildQuery('Samsung Galaxy S10', 'Samsung');
check('код S10 не совпадает с более длинным S100',
  TC.nameMatches(galaxyS10, 'Samsung Galaxy S100'), false);
const sonyXm5 = TC.buildQuery('Sony WH1000XM5', 'Sony');
check('слитный код находится в соседних токенах',
  TC.nameMatches(sonyXm5, 'Sony WH 1000 XM5'), true);

console.log('\n── Аксессуары не выдаются за товар');
ok('чехол отсеивается', TC.isAccessory('Чехол для наушников JBL Tune 520BT') === true);
ok('сами наушники не отсеиваются', TC.isAccessory('Наушники JBL Tune 520BT') === false);

console.log('\n── Обычная цена вместо самой низкой');
// Живой замер: выдача WB по «airpods pro 2» — обычная цена 10 282 ₽,
// а самый дешёвый товар 828 ₽ («AirPods Pro 2 USB-C Оригинал», бренд Apple
// проставил продавец). Брать минимум значит показывать подделку.
const prices = [828, 9500, 10282, 10500, 10900, 11000, 25000];
const typical = TC.typicalOf(prices);
ok('медиана не уезжает к приманке', typical > 9000, `получили ${typical}`);
ok('медиана не уезжает к завышенной', typical < 12000, `получили ${typical}`);
check('якорь рядом — цене верим',
  TC.typicalPrice([828, 9500, 10282, 10500, 10900, 11000].map((p) => ({ price: p })), 10282), 10500);
check('якорь разошёлся в разы — цену выбрасываем',
  TC.typicalPrice([828, 900, 1000, 1100].map((p) => ({ price: p })), 10282), null);

console.log('\n── Вердикт по чужой карточке');
const airpods = TC.buildQuery('AirPods Pro 2', 'Apple');
check('реплика отклоняется',
  TC.judge(airpods, { title: 'AirPods Pro 2 1:1 люкс качество', price: 900, reviews: 0 }, { typical: 10282 }).verdict,
  'reject');
check('настоящая карточка проходит',
  TC.judge(airpods, { title: 'Apple AirPods Pro 2', price: 10500, reviews: 500, verified: true }, { typical: 10282 }).verdict,
  'good');

console.log(`\nИТОГ: ${passed} прошло, ${failed} упало`);
process.exit(failed ? 1 : 0);
