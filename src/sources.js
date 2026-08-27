// Три источника цен. Живут в service worker: только у него есть host_permissions,
// поэтому кросс-доменные запросы уходят без CORS, с реальными куками браузера
// и настоящим TLS-отпечатком Chrome. Из голого http-клиента Ozon и Маркет
// отвечают 403 — из браузера отвечают нормально.
var TC = (globalThis.TC = globalThis.TC || {});

var withTimeout = function (url, opts) {
  var ctl = new AbortController();
  var t = setTimeout(function () { ctl.abort(); }, TC.FETCH_TIMEOUT_MS);
  var o = Object.assign({ credentials: 'include', signal: ctl.signal }, opts || {});
  return fetch(url, o).finally(function () { clearTimeout(t); });
};

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// Ozon пишет цену с узким неразрывным пробелом: «2 245 ₽». Без нормализации
// из неё вычитывается 245 — тихая ошибка в десять раз.
var parseMoney = function (s) {
  var m = String(s || '').replace(/[    ⁠]/g, ' ').match(/\d[\d\s]*/);
  if (!m) return null;
  var n = parseInt(m[0].replace(/\s/g, ''), 10);
  return isFinite(n) && n > 0 ? n : null;
};

// -- Wildberries -----------------------------------------------------------
// search.wb.ru v9 отдаёт готовые карточки с ценами одним запросом.
// Цены лежат в sizes[0].price.{product,basic} и в копейках — верхнеуровневые
// priceU/salePriceU с 2026 года всегда null.
// Эндпоинт склонен к 429 даже на честном трафике, поэтому ретраим.
TC.wbSearch = function (query) {
  var url = 'https://search.wb.ru/exactmatch/ru/common/v9/search'
    + '?appType=1&curr=rub&dest=' + encodeURIComponent(TC.WB_DEST)
    + '&query=' + encodeURIComponent(query)
    + '&resultset=catalog&page=1';

  // 429 здесь — обычное дело даже на честном трафике: WB режет запросы пачками,
  // а не банит, и отпускает через несколько секунд. Ждать стоит: «не удалось
  // узнать цену» в панели выглядит поломкой, хотя площадка просто попросила
  // подождать. Панель всё это время показывает скелетон, так что спешить некуда.
  var BACKOFF = [0, 700, 1600, 3000, 5000];
  var attempt = function (n) {
    return withTimeout(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (r.status === 429 && n < BACKOFF.length - 1) {
        return sleep(BACKOFF[n]).then(function () { return attempt(n + 1); });
      }
      if (!r.ok) throw new Error('wb http ' + r.status);
      return r.json();
    });
  };

  return attempt(1).then(function (data) {
    var list = (data && data.products) || [];
    return list.slice(0, TC.MAX_CANDIDATES).map(function (p) {
      var price = null, old = null;
      var sizes = Array.isArray(p.sizes) ? p.sizes : [];
      for (var i = 0; i < sizes.length; i++) {
        var pr = sizes[i] && sizes[i].price;
        if (pr && pr.product) { price = pr.product / 100; old = (pr.basic || pr.product) / 100; break; }
      }
      return {
        site: 'wb',
        title: [p.brand, p.name].filter(Boolean).join(' '),
        price: price,
        old: old,
        brand: p.brand || '',
        // subjectId — категория WB. У чехла и у наушников она разная,
        // и это надёжнее, чем ловить аксессуары регуляркой по названию.
        category: p.subjectId != null ? p.subjectId : null,
        seller: p.supplier || '',
        sellerRating: p.supplierRating || null,
        rating: p.reviewRating || null,
        reviews: p.feedbacks || 0,
        url: 'https://www.wildberries.ru/catalog/' + p.id + '/detail.aspx'
      };
    }).filter(function (x) { return x.price; });
  });
};

// -- Ozon ------------------------------------------------------------------
// Тот же composer-api, которым Ozon рендерит собственную выдачу.
// Карточка — набор "атомов" в mainState; название и цена лежат там же.
TC.ozonSearch = function (query) {
  var path = '/search/?text=' + encodeURIComponent(query) + '&page=1';
  var url = 'https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=' + encodeURIComponent(path);

  return withTimeout(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
    if (!r.ok) throw new Error('ozon http ' + r.status);
    return r.json();
  }).then(function (data) {
    var widgets = (data && data.widgetStates) || {};
    var out = [], seen = {};

    Object.keys(widgets).forEach(function (key) {
      if (key.indexOf('tileGridDesktop-') !== 0) return;
      var body;
      try { body = typeof widgets[key] === 'string' ? JSON.parse(widgets[key]) : widgets[key]; }
      catch (e) { return; }
      var items = body && body.items;
      if (!Array.isArray(items)) return;

      items.forEach(function (it) {
        if (!it || typeof it !== 'object' || out.length >= TC.MAX_CANDIDATES) return;
        var sku = String(it.sku || it.id || '');
        if (!sku || seen[sku]) return;

        var title = null, price = null, old = null;
        var rating = null, reviews = 0, brand = '', seller = '', verified = false;
        var atoms = Array.isArray(it.mainState) ? it.mainState : [];

        atoms.forEach(function (a) {
          if (!a || typeof a !== 'object') return;

          if (a.type === 'textDS' && a.textDS) {
            var info = a.textDS.testInfo || {};
            var isName = a.id === 'name' || info.automatizationId === 'tile-name';
            if (isName && typeof a.textDS.text === 'string') title = a.textDS.text;

          } else if (a.type === 'priceV2' && a.priceV2) {
            // Ozon помечает цены стилем: PRICE — текущая, ORIGINAL_PRICE —
            // зачёркнутая. Если стиля нет, порядок тоже работает:
            // первая крупная, вторая зачёркнутая.
            var entries = (a.priceV2.price || []).filter(function (e) { return e && e.text; });
            entries.forEach(function (e, i) {
              var v = parseMoney(e.text);
              if (!v) return;
              if (e.textStyle === 'ORIGINAL_PRICE') { if (old === null) old = v; }
              else if (e.textStyle === 'PRICE') { if (price === null) price = v; }
              else if (i === 0) { if (price === null) price = v; }
              else if (i === 1) { if (old === null) old = v; }
            });

          } else if (a.type === 'labelListV2' && a.labelListV2) {
            // Плоский список: иконка, потом текст к ней, потом снова иконка.
            // Что означает текст, понятно только по предыдущей иконке.
            //   ic_s_star_filled_compact      -> рейтинг
            //   ic_s_dialog_filled_compact    -> число отзывов
            //   ic_s_confirmed_filled_compact -> «Бренд проверен»
            //   ic_s_ozon_circle_filled_compact -> продаёт сам Ozon
            //   без иконки (в tile-list-labels) -> бренд
            var last = '';
            (a.labelListV2.items || []).forEach(function (li) {
              if (!li) return;
              if (li.type === 'icon') {
                last = (((li.icon || {}).icon || {}).icon) || '';
                return;
              }
              if (li.type !== 'text') return;
              var txt = String((li.text || {}).text || '').trim();
              if (!txt) return;

              if (/star/i.test(last)) {
                var r = parseFloat(txt.replace(',', '.'));
                if (isFinite(r) && r > 0 && r <= 5) rating = r;
              } else if (/dialog/i.test(last)) {
                var n = parseInt(txt.replace(/[^\d]/g, ''), 10);
                if (isFinite(n)) reviews = n;
              } else if (/confirmed/i.test(last)) {
                verified = true;
              } else if (/ozon_circle/i.test(last)) {
                seller = 'Ozon';
              } else if (!last && !brand && !/\d/.test(txt) && txt.length <= 24) {
                brand = txt;
              }
              last = '';
            });
          }
        });

        // Запасной путь: у части плиток имя приходит простым textAtom.
        // Там же живёт "осталось N шт" — его за название принимать нельзя.
        if (!title) {
          for (var i = 0; i < atoms.length; i++) {
            var a2 = atoms[i];
            var t = a2 && a2.type === 'textAtom' && a2.textAtom && a2.textAtom.text;
            if (typeof t === 'string' && !/осталось|\bшт\b/i.test(t)) { title = t; break; }
          }
        }
        if (!title || !price) return;

        var link = (it.action && it.action.link) || '';
        seen[sku] = 1;
        out.push({
          site: 'ozon',
          title: title,
          price: price,
          old: old,
          brand: brand,     // есть примерно у трети плиток, у остальных пусто
          category: null,   // категорию Ozon в выдаче не отдаёт
          seller: seller,   // «Ozon» = продаёт сама площадка, это надёжно
          verified: verified,
          sellerRating: null,
          rating: rating,
          reviews: reviews,
          url: link ? 'https://www.ozon.ru' + link.split('?')[0] : TC.SITES.ozon.search(query)
        });
      });
    });

    return out;
  });
};

// -- Яндекс Маркет ---------------------------------------------------------
// JSON-ручки закрыты (api/resolve отдаёт 403), зато на странице выдачи лежит
// schema.org-разметка ItemList с ценами. Она стабильнее вёрстки и не зависит
// от того, как Маркет в очередной раз переименовал css-классы.
TC.ymSearch = function (query) {
  var url = 'https://market.yandex.ru/search?text=' + encodeURIComponent(query);

  return withTimeout(url, { headers: { 'Accept': 'text/html,application/xhtml+xml' } }).then(function (r) {
    if (!r.ok) throw new Error('ym http ' + r.status);
    return r.text();
  }).then(function (html) {
    var re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    var m, out = [];

    while ((m = re.exec(html))) {
      var data;
      try { data = JSON.parse(m[1]); } catch (e) { continue; }
      if (!data || data['@type'] !== 'ItemList') continue;

      (data.itemListElement || []).slice(0, TC.MAX_CANDIDATES).forEach(function (el) {
        var item = el && el.item;
        if (!item || !item.name) return;
        var offers = item.offers || {};
        var price = Number(offers.price != null ? offers.price : offers.lowPrice);
        if (!isFinite(price) || price <= 0) return;
        var rating = item.aggregateRating || {};
        out.push({
          site: 'ym',
          title: item.name,
          price: price,
          old: null,
          rating: Number(rating.ratingValue) || null,
          reviews: Number(rating.reviewCount) || 0,
          url: offers.url || item['@id'] || TC.SITES.ym.search(query)
        });
      });
      if (out.length) break;
    }

    if (!out.length && /showcaptcha|SmartCaptcha/i.test(html)) throw new Error('ym captcha');
    return out;
  });
};

TC.SEARCH = { wb: TC.wbSearch, ozon: TC.ozonSearch, ym: TC.ymSearch };
