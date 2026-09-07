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

console.log('\n── Разное написание одних и тех же характеристик');
const spacedCapacity = TC.buildQuery('Повербанк Acme PBX100 20000 мАч', 'Acme');
check('«20000 мАч» совпадает с «20000mAh»',
  TC.nameMatches(spacedCapacity, 'Acme Power Bank PBX100 20000mAh'), true);
const spacedMemory = TC.buildQuery('Смартфон Apple iPhone 15 128 ГБ', 'Apple');
check('«128 ГБ» совпадает с «128GB»',
  TC.nameMatches(spacedMemory, 'Apple iPhone 15 128GB'), true);
check('характеристика 128 ГБ не заменяется 256GB',
  TC.nameMatches(spacedMemory, 'Apple iPhone 15 256GB'), false);
check('обязательная характеристика не исчезает из названия',
  TC.nameMatches(spacedMemory, 'Apple iPhone 15'), false);
check('число не склеивает 128 ГБ с 1280GB',
  TC.nameMatches(spacedMemory, 'Apple iPhone 15 1280GB'), false);

const joinedMemory = TC.buildQuery('Смартфон Apple iPhone 15 128GB', 'Apple');
check('joined-source 128GB совпадает с раздельными 128 ГБ',
  TC.nameMatches(joinedMemory, 'Смартфон Apple iPhone 15 128 ГБ'), true);
check('joined-source 128GB не допускает карточку без памяти',
  TC.nameMatches(joinedMemory, 'Смартфон Apple iPhone 15'), false);
check('joined-source 128GB не допускает другую память',
  TC.nameMatches(joinedMemory, 'Смартфон Apple iPhone 15 256GB'), false);

const joinedCapacity = TC.buildQuery('Повербанк Acme PBX100 20000mAh', 'Acme');
check('joined-source 20000mAh совпадает с раздельными 20000 мАч',
  TC.nameMatches(joinedCapacity, 'Повербанк Acme PBX100 20000 мАч'), true);
check('joined-source 20000mAh не допускает карточку без ёмкости',
  TC.nameMatches(joinedCapacity, 'Повербанк Acme PBX100'), false);

const decimalVolume = TC.buildQuery('Напиток Acme Fresh 1,5 л', 'Acme');
check('десятичный объём совпадает со слитным 1.5L',
  TC.nameMatches(decimalVolume, 'Напиток Acme Fresh 1.5L'), true);
check('десятичный объём не исчезает из обязательных признаков',
  TC.nameMatches(decimalVolume, 'Напиток Acme Fresh без сахара'), false);
const preciseDecimalVolume = TC.buildQuery('Напиток Acme FreshX 1,25 л', 'Acme');
check('двузначная дробная часть 1,25 л совпадает со слитным 1.25L',
  TC.nameMatches(preciseDecimalVolume, 'Напиток Acme FreshX 1.25L'), true);
check('двузначная дробная характеристика остаётся обязательной',
  TC.nameMatches(preciseDecimalVolume, 'Напиток Acme FreshX'), false);

const decimalWattage = TC.buildQuery('Лампа Acme Glow 1,5 Вт', 'Acme');
check('мягкая десятичная характеристика совпадает со слитным 1.5W',
  TC.nameMatches(decimalWattage, 'Лампа Acme Glow 1.5W'), true);
check('числовая часть мягкой характеристики не пропадает молча',
  TC.nameMatches(decimalWattage, 'Лампа Acme Glow'), false);

const spacedWattage = TC.buildQuery('Лампа Acme Glow 100 Вт', 'Acme');
check('раздельные 100 Вт совпадают со слитными 100W',
  TC.nameMatches(spacedWattage, 'Лампа Acme Glow 100W'), true);
check('раздельные 100 Вт не заменяются другой мощностью',
  TC.nameMatches(spacedWattage, 'Лампа Acme Glow 65W'), false);

[
  ['500ml', '500 мл', 'Шампунь Acme CareX'],
  ['1L', '1 л', 'Напиток Acme FreshX'],
  ['500g', '500 г', 'Кофе Acme RoastX'],
  ['2шт', '2 шт', 'Набор Acme ToolX']
].forEach(function (sample) {
  const joined = TC.buildQuery(sample[2] + ' ' + sample[0], 'Acme');
  check(sample[0] + ' совпадает с раздельной записью ' + sample[1],
    TC.nameMatches(joined, sample[2] + ' ' + sample[1]), true);
  check(sample[0] + ' не исчезает из обязательных признаков',
    TC.nameMatches(joined, sample[2]), false);
});

const sameNumberTerabytes = TC.buildQuery('SSD Acme Model 2 2 ТБ', 'Acme');
check('число модели и 2 ТБ совпадают с эквивалентными 2000GB',
  TC.nameMatches(sameNumberTerabytes, 'SSD Acme Model 2 2000GB'), true);
check('число модели и 2 ТБ совпадают с эквивалентными 2048 ГБ',
  TC.nameMatches(sameNumberTerabytes, 'SSD Acme Model 2 2048 ГБ'), true);

const joinedTerabytes = TC.buildQuery('SSD Acme DriveX 1TB', 'Acme');
check('joined-source 1TB совпадает с маркетинговыми 1000 ГБ',
  TC.nameMatches(joinedTerabytes, 'SSD Acme DriveX 1000 ГБ'), true);
check('joined-source 1TB не допускает карточку без объёма',
  TC.nameMatches(joinedTerabytes, 'SSD Acme DriveX'), false);
check('явный конфликт TB нельзя замаскировать эквивалентным числом в GB',
  TC.nameMatches(joinedTerabytes, 'SSD Acme DriveX 2TB 1000GB'), false);

const joinedGigabytes = TC.buildQuery('SSD Acme DriveY 1000GB', 'Acme');
check('joined-source 1000GB совпадает с 1 ТБ',
  TC.nameMatches(joinedGigabytes, 'SSD Acme DriveY 1 ТБ'), true);
const joinedBinaryGigabytes = TC.buildQuery('SSD Acme DriveZ 1024GB', 'Acme');
check('joined-source 1024GB тоже совпадает с 1 ТБ',
  TC.nameMatches(joinedBinaryGigabytes, 'SSD Acme DriveZ 1TB'), true);

const xiaomiSameNumber = TC.buildQuery('Смартфон Xiaomi 12 12 ГБ', 'Xiaomi');
check('модель Xiaomi 12 совпадает со склеенными 12GB',
  TC.nameMatches(xiaomiSameNumber, 'Смартфон Xiaomi 12 12GB'), true);
check('12GB не выдаёт чужой Xiaomi Redmi Note 13 за модель Xiaomi 12',
  TC.nameMatches(xiaomiSameNumber, 'Смартфон Xiaomi Redmi Note 13 12GB'), false);
check('раздельные 12 ГБ тоже не выдают Redmi Note 13 за Xiaomi 12',
  TC.nameMatches(xiaomiSameNumber, 'Смартфон Xiaomi Redmi Note 13 12 ГБ'), false);
check('чужая модель с той же памятью не даёт sure-price',
  TC.pickOffer(xiaomiSameNumber, [{
    title: 'Смартфон Xiaomi Redmi Note 13 12GB',
    price: 50000,
    brand: 'Xiaomi',
    reviews: 100
  }], 50000), null);

const xiaomiJoinedSameNumber = TC.buildQuery('Смартфон Xiaomi 12 12GB', 'Xiaomi');
check('joined-source сохраняет отдельные роли модели 12 и памяти 12GB',
  TC.nameMatches(xiaomiJoinedSameNumber, 'Смартфон Xiaomi 12 12 ГБ'), true);
check('joined-source 12GB не маскирует Redmi Note 13 под Xiaomi 12',
  TC.nameMatches(xiaomiJoinedSameNumber, 'Смартфон Xiaomi Redmi Note 13 12 ГБ'), false);

const iphoneSameNumber = TC.buildQuery('Apple iPhone 12 12 ГБ', 'Apple');
check('iPhone 12 с 12GB сохраняет отдельные роли модели и памяти',
  TC.nameMatches(iphoneSameNumber, 'Apple iPhone 12 12GB'), true);
check('12GB не маскирует iPhone 13 под iPhone 12',
  TC.nameMatches(iphoneSameNumber, 'Apple iPhone 13 12GB'), false);

const repeatedModelNumber = TC.buildQuery('Xiaomi 12 Edition 12 12 ГБ', 'Xiaomi');
check('повторы base-number сохраняют кратность',
  TC.nameMatches(repeatedModelNumber, 'Xiaomi 12 Edition 12 12GB'), true);
check('один base-number не заменяет два обязательных повтора',
  TC.nameMatches(repeatedModelNumber, 'Xiaomi 12 Edition Pro 12GB'), false);

const malformedNumberRole = TC.buildQuery('Acme Device 42', 'Acme');
malformedNumberRole.numberRoles['42'] = { base: 0, specs: [] };
check('повреждённая пустая числовая роль обрабатывается fail-closed',
  TC.nameMatches(malformedNumberRole, 'Acme Device 42'), false);

console.log('\n── Несколько характеристик с одной единицей');
const dualMemoryPhone = TC.buildQuery('Смартфон Samsung Galaxy A55 8 ГБ 256 ГБ', 'Samsung');
check('A55 с RAM и накопителем совпадает с собственным названием',
  TC.nameMatches(dualMemoryPhone, dualMemoryPhone.source), true);
check('A55 с двумя значениями памяти совпадает со слитными единицами',
  TC.nameMatches(dualMemoryPhone, 'Samsung Galaxy A55 8GB 256GB'), true);
check('A55 с другой RAM не совпадает',
  TC.nameMatches(dualMemoryPhone, 'Samsung Galaxy A55 12GB 256GB'), false);
check('A55 с другим накопителем не совпадает',
  TC.nameMatches(dualMemoryPhone, 'Samsung Galaxy A55 8GB 512GB'), false);
check('A55 без второго значения памяти не совпадает',
  TC.nameMatches(dualMemoryPhone, 'Samsung Galaxy A55 8GB'), false);
check('A54 с той же памятью не заменяет A55',
  TC.nameMatches(dualMemoryPhone, 'Samsung Galaxy A54 8GB 256GB'), false);

const joinedDualMemoryPhone = TC.buildQuery('Samsung Galaxy A55 8GB 256GB', 'Samsung');
check('слитная двойная память совпадает с раздельной',
  TC.nameMatches(joinedDualMemoryPhone, dualMemoryPhone.source), true);
check('слитная двойная память не скрывает другой накопитель',
  TC.nameMatches(joinedDualMemoryPhone, 'Samsung Galaxy A55 8GB 512GB'), false);
check('слитная двойная память не допускает пропуск накопителя',
  TC.nameMatches(joinedDualMemoryPhone, 'Samsung Galaxy A55 8GB'), false);
check('одиночная память не подтверждает карточку с дополнительным объёмом',
  TC.nameMatches(TC.buildQuery('Samsung Galaxy A55 8GB', 'Samsung'),
    'Samsung Galaxy A55 8GB 256GB'), false);

const dualMemoryLaptop = TC.buildQuery('Ноутбук Lenovo IdeaPad 16 ГБ 512 ГБ', 'Lenovo');
check('IdeaPad с RAM и накопителем совпадает с собственным названием',
  TC.nameMatches(dualMemoryLaptop, dualMemoryLaptop.source), true);
check('IdeaPad с двумя значениями памяти совпадает со слитными единицами',
  TC.nameMatches(dualMemoryLaptop, 'Lenovo IdeaPad 16GB 512GB'), true);
check('IdeaPad с другой RAM не совпадает',
  TC.nameMatches(dualMemoryLaptop, 'Lenovo IdeaPad 32GB 512GB'), false);
check('IdeaPad с другим накопителем не совпадает',
  TC.nameMatches(dualMemoryLaptop, 'Lenovo IdeaPad 16GB 256GB'), false);
check('перестановка повторной единицы требует ручной проверки роли',
  TC.nameMatches(dualMemoryLaptop, 'Lenovo IdeaPad 512GB 16GB'), false);
check('лишнее повторение объёма не подтверждает ту же комплектацию',
  TC.nameMatches(dualMemoryLaptop, 'Lenovo IdeaPad 16GB 512GB 512GB'), false);
const dualMemoryOffers = [
  { title: 'Samsung Galaxy A55 8GB 512GB', price: 40000, brand: 'Samsung', reviews: 100 },
  { title: 'Samsung Galaxy A55 8GB 256GB', price: 50000, brand: 'Samsung', reviews: 100 }
];
check('sure-price выбирает ту же двойную память, даже если чужая комплектация дешевле',
  TC.pickOffer(dualMemoryPhone, dualMemoryOffers, 50000)?.item.title,
  'Samsung Galaxy A55 8GB 256GB');
check('чужая двойная память не даёт sure-price из слитного source',
  TC.pickOffer(joinedDualMemoryPhone, [dualMemoryOffers[0]], 50000), null);

const numericModelDualMemory = TC.buildQuery('Xiaomi 12 12 ГБ 256 ГБ', 'Xiaomi');
check('число модели сохраняется вместе с двумя значениями памяти',
  TC.nameMatches(numericModelDualMemory, 'Xiaomi 12 12GB 256GB'), true);
check('число RAM не заменяет модель при двух значениях памяти',
  TC.nameMatches(numericModelDualMemory, 'Xiaomi 13 12GB 256GB'), false);

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

const categoryQuery = TC.buildQuery('Apple AirPods Pro 2', 'Apple');
const categoryNoise = [
  { title: 'Чехол для Apple AirPods Pro 2', price: 900, category: 10, reviews: 10 },
  { title: 'Кейс для Apple AirPods Pro 2', price: 1000, category: 10, reviews: 10 },
  { title: 'Apple AirPods Pro 2', price: 10500, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 11000, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2', price: 10800, category: 30, reviews: 100, brand: 'Apple' }
];
const categoryPick = TC.pickOffer(categoryQuery, categoryNoise, 10700);
ok('категория аксессуаров не скрывает настоящий товар',
  categoryPick && categoryPick.sure && categoryPick.item.category !== 10,
  JSON.stringify(categoryPick));

const rejectedCategoryMajority = [
  { title: 'Чехол для Apple AirPods Pro 2', price: 700, category: 10, reviews: 10 },
  { title: 'Кейс для Apple AirPods Pro 2', price: 800, category: 10, reviews: 10 },
  { title: 'Амбушюры для Apple AirPods Pro 2', price: 900, category: 10, reviews: 10 },
  { title: 'Apple AirPods Pro 2', price: 10500, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 11000, category: 20, reviews: 100, brand: 'Apple' }
];
const rejectedMajorityPick = TC.pickOffer(categoryQuery, rejectedCategoryMajority, 10700);
check('доминантная категория считается только после отсева аксессуаров',
  rejectedMajorityPick && rejectedMajorityPick.item.price, 10500);

const permutations = function (items) {
  if (items.length < 2) return [items];
  const out = [];
  items.forEach(function (item, index) {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    permutations(rest).forEach(function (tail) { out.push([item].concat(tail)); });
  });
  return out;
};
const tiedCategoryOffers = [
  { title: 'Apple AirPods Pro 2', price: 10500, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 11000, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2', price: 9000, category: 30, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 9200, category: 30, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2', price: 10800, category: 40, reviews: 100, brand: 'Apple' }
];
const tiedCategoryPicks = permutations(tiedCategoryOffers).map(function (offers) {
  return {
    category: TC.dominantCategory(offers),
    pick: TC.pickOffer(categoryQuery, offers, 10700)
  };
});
ok('ничья категорий не фильтрует валидные предложения и не зависит от порядка',
  tiedCategoryPicks.every(function (result) {
    return result.category === null
      && result.pick
      && result.pick.item.price === 9000
      && result.pick.checked === tiedCategoryOffers.length;
  }),
  JSON.stringify(tiedCategoryPicks.map(function (result) {
    return {
      category: result.category,
      price: result.pick && result.pick.item.price,
      checked: result.pick && result.pick.checked
    };
  }).filter(function (result, index, all) {
    return index === all.findIndex(function (other) {
      return JSON.stringify(other) === JSON.stringify(result);
    });
  })));

const exactHalfCategoryOffers = [
  { title: 'Apple AirPods Pro 2', price: 10500, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 10600, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2', price: 10700, category: 20, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 9000, category: 30, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2', price: 9200, category: 30, reviews: 100, brand: 'Apple' },
  { title: 'Apple AirPods Pro 2 USB-C', price: 9400, category: 30, reviews: 100, brand: 'Apple' }
];
const exactHalfPicks = permutations(exactHalfCategoryOffers).map(function (offers) {
  return {
    category: TC.dominantCategory(offers),
    pick: TC.pickOffer(categoryQuery, offers, 10700)
  };
});
ok('точная половина 3/3 не становится большинством при любой перестановке',
  exactHalfPicks.every(function (result) {
    return result.category === null
      && result.pick
      && result.pick.item.price === 9000
      && result.pick.checked === exactHalfCategoryOffers.length;
  }));

const strictMajorityCategories = [20, 20, 20, 30, 40].map(function (category) {
  return { category: category };
});
check('строгое большинство категории устойчиво к порядку',
  Array.from(new Set(permutations(strictMajorityCategories).map(function (offers) {
    return TC.dominantCategory(offers);
  }))),
  [20]);

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
