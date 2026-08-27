// Выбор предложения из чужой выдачи.
//
// Здесь живёт главное решение всего расширения: НЕ брать самое дешёвое.
// Подделки, б/у и «не та комплектация» всегда лежат в дешёвом хвосте выдачи,
// поэтому минимум по цене — это систематически именно они. Чем лучше такое
// расширение «ищет выгоду», тем чаще оно врёт.
var TC = (globalThis.TC = globalThis.TC || {});

/**
 * Усечённая медиана: отбрасываем нижние 20% и верхние 10%, считаем по остатку.
 * Обычная медиана хуже — мусор распределён несимметрично, дешёвый хвост
 * всегда толще.
 */
TC.typicalOf = function (prices) {
  var a = prices.slice().sort(function (x, y) { return x - y; });
  if (a.length < TC.MIN_FOR_MEDIAN) return null;
  var core = a.slice(Math.floor(a.length * 0.2), Math.ceil(a.length * 0.9));
  if (!core.length) core = a;
  var m = core.length >> 1;
  return core.length % 2 ? core[m] : (core[m - 1] + core[m]) / 2;
};

/**
 * Медиана чужой выдачи — второй ориентир, и доверять ей можно не всегда.
 * По хайповым товарам подделок в выдаче больше, чем настоящих: по запросу
 * «airpods pro 2» половина карточек — копии за одну-две тысячи, и медиана
 * уезжает туда же. Если она разошлась со своей ценой в разы — выбрасываем
 * её и опираемся только на цену открытой страницы, она всегда честная.
 */
TC.typicalPrice = function (named, anchor) {
  var t = TC.typicalOf(named.map(function (it) { return it.price; }));
  if (!t) return null;
  if (!anchor) return t;
  if (t < anchor * 0.4 || t > anchor * 2.5) return null;
  return t;
};

/**
 * Категория товара, если площадка её отдаёт (у WB это subjectId).
 * У чехла и у наушников она разная. Если большинство похожих карточек лежит
 * в одной категории, всё, что вне её, к товару отношения не имеет —
 * это точнее, чем ловить аксессуары по словам в названии.
 */
TC.dominantCategory = function (items) {
  var count = {}, best = null, bestN = 0, total = 0;
  items.forEach(function (it) {
    if (it.category == null) return;
    total++;
    count[it.category] = (count[it.category] || 0) + 1;
    if (count[it.category] > bestN) { bestN = count[it.category]; best = it.category; }
  });
  if (total < TC.MIN_FOR_MEDIAN || bestN < total * 0.4) return null;
  return best;
};

/**
 * -> { item, sure, typical, seen, checked } либо null.
 *
 * sure = false означает «похоже на наш товар, но поручиться нельзя»:
 * такую цену показываем, а разницу в рублях — нет.
 */
TC.pickOffer = function (q, items, anchor) {
  var named = items.filter(function (it) { return TC.nameMatches(q, it.title); });
  if (!named.length) return null;

  // Два прохода. Сначала опознаём товар вообще без цен — по этим карточкам
  // и считаем, сколько он стоит. Если мешать цены сразу, опорная цена
  // посчитается в том числе по мусору, который мы и собирались отсеять.
  var same = named.filter(function (it) { return TC.judge(q, it, {}).verdict !== 'reject'; });
  var typical = TC.typicalPrice(same.length >= TC.MIN_FOR_MEDIAN ? same : named, anchor);

  var cat = TC.dominantCategory(named);
  // Опорной цене можно доверять как отсекающей, только когда есть своя цена:
  // typicalPrice сверяет их между собой. Без своей цены медиана ничем
  // не подстрахована — по широкому запросу она уезжает куда угодно
  // и начинает отбрасывать как раз настоящий товар.
  var refs = { typical: typical, anchor: anchor, trustTypical: !!anchor };

  var good = [], weak = [], checked = 0;
  named.forEach(function (it) {
    if (cat != null && it.category != null && it.category !== cat) return;
    checked++;
    var v = TC.judge(q, it, refs);
    if (v.verdict === 'good') good.push(it);
    else if (v.verdict === 'weak') { it.doubt = v.reason; weak.push(it); }
  });

  // Берём самое дешёвое из подошедших — но не то, чьё название похоже на наш
  // товар заметно хуже остальных. Иначе среди двух одинаково «подходящих»
  // выигрывает тот, что просто дешевле, даже если это соседняя модель.
  var pack = function (list, sure) {
    var best = 0;
    list.forEach(function (it) {
      it.sim = TC.similarity(q.source, it.title);
      if (it.sim > best) best = it.sim;
    });
    var close = list.filter(function (it) { return it.sim >= best * 0.6; });
    if (!close.length) close = list;
    close.sort(function (a, b) { return a.price - b.price; });
    return { item: close[0], sure: sure, typical: typical, seen: named.length, checked: checked };
  };

  if (good.length) return pack(good, true);
  if (weak.length) return pack(weak, false);
  return null;
};
