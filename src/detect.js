// Определяем, на карточке какого товара мы стоим и сколько он тут стоит.
// Вёрстка маркетплейсов меняется часто, поэтому у каждого поля несколько
// путей: сначала машиночитаемая разметка, потом атрибуты, потом текст.
var TC = (globalThis.TC = globalThis.TC || {});

var text = function (sel, root) {
  var el = (root || document).querySelector(sel);
  return el ? (el.textContent || '').trim() : '';
};

// Разряды в ценах площадки разделяют не обычным пробелом, а узким неразрывным
// (U+2009, U+00A0 и родня). Без нормализации «2 245 ₽» читается как 245 ₽ —
// регулярка просто не видит первую цифру. Ошибка тихая и очень дорогая.
var SPACES = /[    ⁠]/g;

var priceFrom = function (s) {
  var m = String(s || '').replace(SPACES, ' ').match(/(\d[\d ]{0,9})\s*(?:₽|руб)/);
  if (!m) return null;
  var n = parseInt(m[1].replace(/\s/g, ''), 10);
  return isFinite(n) && n > 0 ? n : null;
};

var firstPrice = function (selectors) {
  for (var i = 0; i < selectors.length; i++) {
    var nodes = document.querySelectorAll(selectors[i]);
    for (var j = 0; j < nodes.length; j++) {
      var p = priceFrom(nodes[j].textContent);
      if (p) return p;
    }
  }
  return null;
};

// schema.org-разметка карточки. Есть не везде, но если есть — самая честная.
var fromLd = function () {
  var nodes = document.querySelectorAll('script[type="application/ld+json"]');
  for (var i = 0; i < nodes.length; i++) {
    var data;
    try { data = JSON.parse(nodes[i].textContent); } catch (e) { continue; }
    var list = Array.isArray(data) ? data : [data];
    for (var j = 0; j < list.length; j++) {
      var d = list[j];
      if (!d || d['@type'] !== 'Product') continue;
      var offers = d.offers || {};
      if (Array.isArray(offers)) offers = offers[0] || {};
      var price = Number(offers.price != null ? offers.price : offers.lowPrice);
      var brand = d.brand;
      if (brand && typeof brand === 'object') brand = brand.name || '';
      return {
        title: d.name || '',
        price: isFinite(price) && price > 0 ? price : null,
        brand: typeof brand === 'string' ? brand : ''
      };
    }
  }
  return null;
};

var DETECTORS = {
  ozon: {
    test: function () { return /(^|\.)ozon\.ru$/.test(location.hostname) && /\/product\//.test(location.pathname); },
    id: function () { var m = location.pathname.match(/\/product\/[^/]*?(\d{6,})\/?$/); return m ? m[1] : location.pathname; },
    title: function () { return text('h1'); },
    price: function () {
      return firstPrice([
        '[data-widget="webPrice"]',
        '[data-widget="webOutOfStock"]',
        '[data-widget="webSale"]'
      ]);
    }
  },

  wb: {
    test: function () { return /(^|\.)wildberries\.ru$/.test(location.hostname) && /\/catalog\/\d+\//.test(location.pathname); },
    id: function () { var m = location.pathname.match(/\/catalog\/(\d+)\//); return m ? m[1] : location.pathname; },
    // Классы у WB теперь хешированные и меняются с каждой сборкой
    // (productTitle--jKvWV), поэтому цепляемся за устойчивую часть имени.
    // Старые селекторы оставлены запасными: вёрстка ездит туда-сюда.
    brand: function () {
      return text('[class*="productNameBrand"]')
        || text('.product-page__header-brand')
        || text('[class*="header-brand"]');
    },
    title: function () {
      // Бренд у WB вынесен из заголовка, а для поиска на других площадках
      // он важнее всего.
      var brand = DETECTORS.wb.brand();
      var name = text('[class*="productTitle"]')
        || text('.product-page__title')
        || text('h1');
      return [brand, name].filter(Boolean).join(' ').trim();
    },
    price: function () {
      // Берём цену БЕЗ скидки по Кошельку. На странице крупно висит именно
      // кошельковая (4 340 ₽), но поиск WB отдаёт обычную (4 429 ₽) —
      // sizes[0].price.product. Сравнивать можно только на одной базе,
      // иначе на каждом товаре появляется выдуманная разница в пару процентов.
      return firstPrice([
        '[class*="priceBlockFinalPrice"]',
        '.price-block__final-price',
        '[class*="price-block__final"]',
        '[class*="productLinePriceWallet"]',
        '.price-block__wallet-price'
      ]);
    }
  },

  ym: {
    test: function () { return /(^|\.)market\.yandex\.ru$/.test(location.hostname) && /\/(card|product)/.test(location.pathname); },
    id: function () { var m = location.pathname.match(/(\d{6,})/); return m ? m[1] : location.pathname; },
    title: function () { return text('h1'); },
    price: function () {
      var ld = fromLd();
      if (ld && ld.price) return ld.price;
      return firstPrice([
        '[data-auto="price-value"]',
        '[data-auto="snippet-price-current"]',
        '[data-auto="mainPrice"]'
      ]);
    }
  }
};

/**
 * -> { site, id, title, price, brand } либо null, если карточка ещё
 * не отрисовалась.
 *
 * Цена не обязательна, но без неё сверять почти нечем: своя цена —
 * главный ориентир, по которому отсеиваются подделки.
 * Бренд тоже не обязателен: он есть у WB и Маркета, у Ozon — как повезёт.
 */
TC.detect = function () {
  var ids = Object.keys(DETECTORS);
  for (var i = 0; i < ids.length; i++) {
    var d = DETECTORS[ids[i]];
    if (!d.test()) continue;

    var ld = null;
    var lazyLd = function () { if (ld === null) ld = fromLd() || false; return ld; };

    var title = '';
    try { title = d.title(); } catch (e) { title = ''; }
    if (!title) title = (lazyLd() && lazyLd().title) || '';
    if (!title || title.length < 3) return null;

    var price = null;
    try { price = d.price(); } catch (e) { price = null; }

    var brand = '';
    try { brand = d.brand ? d.brand() : ''; } catch (e) { brand = ''; }
    if (!brand) brand = (lazyLd() && lazyLd().brand) || '';

    return {
      site: ids[i],
      id: d.id(),
      title: title.replace(/\s+/g, ' ').trim(),
      price: price,
      brand: String(brand || '').trim()
    };
  }
  return null;
};
