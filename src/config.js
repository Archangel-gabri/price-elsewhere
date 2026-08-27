// Общие константы. Файл грузится и в content script, и в service worker,
// поэтому namespace вешается на globalThis и переживает повторную загрузку.
var TC = (globalThis.TC = globalThis.TC || {});

TC.VERSION = '1.1.0';

// Регион для цен Wildberries. -1257786 — Москва.
// Без dest WB отдаёт пустые остатки, неверные цены или HTML-заглушку Cloudflare.
TC.WB_DEST = '-1257786';

TC.SITES = {
  ozon: {
    id: 'ozon',
    name: 'Ozon',
    search: function (q) {
      return 'https://www.ozon.ru/search/?text=' + encodeURIComponent(q);
    }
  },
  wb: {
    id: 'wb',
    name: 'Wildberries',
    search: function (q) {
      return 'https://www.wildberries.ru/catalog/0/search.aspx?search=' + encodeURIComponent(q);
    }
  },
  ym: {
    id: 'ym',
    name: 'Яндекс Маркет',
    search: function (q) {
      return 'https://market.yandex.ru/search?text=' + encodeURIComponent(q);
    }
  }
};

TC.ORDER = ['ozon', 'wb', 'ym'];

TC.CACHE_TTL_MS = 10 * 60 * 1000; // один и тот же запрос не дёргаем чаще
TC.FETCH_TIMEOUT_MS = 12000;
TC.MAX_CANDIDATES = 60; // сколько карточек чужой выдачи разбираем

// -- Пороги цены -----------------------------------------------------------
// Опорная цена (ref) — это НЕ минимум по выдаче, а медиана по карточкам,
// похожим на наш товар: столько он на этой площадке стоит на самом деле.
// Считать от минимума нельзя: подделки, б/у и «не та комплектация» всегда
// лежат в дешёвом хвосте, и «самое выгодное предложение» — почти всегда они.
TC.PRICE_FLOOR = 0.40; // дешевле опорной — это уже точно другой товар
TC.PRICE_DOUBT = 0.62; // дешевле опорной — показываем, но с оговоркой
TC.PRICE_CEIL = 3.0;   // дороже опорной — опт, набор или другая модель

// Своя цена — второй ориентир. Между площадками разброс в полтора раза
// бывает честным, в два — уже почти нет.
TC.ANCHOR_FLOOR = 0.35;
TC.ANCHOR_DOUBT = 0.60;

// Медиана по трём карточкам ничего не значит. Меньше этого числа
// совпадений — опираемся только на свою цену.
TC.MIN_FOR_MEDIAN = 5;

TC.money = function (rub) {
  if (rub === null || rub === undefined || !isFinite(rub)) return null;
  return Math.round(rub).toLocaleString('ru-RU').replace(/\u00A0/g, ' ') + ' \u20BD';
};
