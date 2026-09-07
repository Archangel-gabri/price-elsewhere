// Выбор предложения из чужой выдачи.
//
// Сначала фильтруем кандидатов по названию/комплектации и ценовым эвристикам,
// затем выбираем минимум среди достаточно похожих оставшихся предложений.
// Низкая цена сама по себе не доказывает подделку, а прохождение фильтров —
// подлинность товара или одинаковые условия оплаты.
var TC = (globalThis.TC = globalThis.TC || {});

/**
 * Усечённая медиана: отбрасываем нижние 20% и верхние 10%, считаем по остатку.
 * Это эвристический ориентир для данной выборки, не проверка рынка/подлинности.
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
 * Дешёвые нерелевантные карточки могут смещать ориентир. Если он разошёлся
 * с ценой открытой страницы в разы, не используем его как второй anchor.
 * Цена страницы тоже может зависеть от банка/кошелька и не включать пошлины.
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
 * в одной категории, применяем её как дополнительный эвристический фильтр;
 * ошибочная классификация площадки всё ещё возможна.
 */
TC.dominantCategory = function (items) {
  var count = {}, best = null, bestN = 0, total = 0;
  items.forEach(function (it) {
    if (it.category == null) return;
    total++;
    count[it.category] = (count[it.category] || 0) + 1;
    if (count[it.category] > bestN) { bestN = count[it.category]; best = it.category; }
  });
  // Порядок выдачи не должен разрешать ничью 2/2/1 в пользу категории,
  // которая первой набрала два совпадения. Фильтруем только при строгом
  // большинстве: тогда победитель единственный независимо от перестановки.
  if (total < TC.MIN_FOR_MEDIAN || bestN <= total / 2) return null;
  return best;
};

/**
 * -> { item, sure, typical, seen, checked } либо null.
 *
 * sure относится только к совпадению товара. Панель не вычисляет разницу
 * в рублях даже для sure=true: сопоставимость условий оплаты не подтверждена.
 */
TC.pickOffer = function (q, items, anchor) {
  var named = items.filter(function (it) { return TC.nameMatches(q, it.title); });
  if (!named.length) return null;

  // Два прохода. Сначала опознаём товар вообще без цен — по этим карточкам
  // и считаем, сколько он стоит. Если мешать цены сразу, опорная цена
  // посчитается в том числе по мусору, который мы и собирались отсеять.
  var same = named.filter(function (it) { return TC.judge(q, it, {}).verdict !== 'reject'; });
  var typical = TC.typicalPrice(same.length >= TC.MIN_FOR_MEDIAN ? same : named, anchor);

  // Категорию выводим только после текстового отсева. Иначе два чехла из пяти
  // name-matching карточек могут стать «доминирующей» категорией и скрыть товар.
  var cat = TC.dominantCategory(same);
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
