// Service worker: единственное место, откуда можно ходить на чужие домены.
// Content script только просит «сравни вот это» и получает готовый ответ.
importScripts('/src/config.js', '/src/query.js', '/src/pick.js', '/src/sources.js');

var cache = new Map();

var cacheGet = function (key) {
  var hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TC.CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
};

var cacheSet = function (key, value) {
  cache.set(key, { at: Date.now(), value: value });
  if (cache.size > 120) cache.delete(cache.keys().next().value);
};

var askSource = function (site, q, anchor) {
  var fn = TC.SEARCH[site];
  if (!fn) return Promise.resolve({ status: 'error' });

  return fn(q.text).then(function (items) {
    var best = TC.pickOffer(q, items, anchor);
    if (!best) return { status: 'nomatch', total: items.length };
    return {
      status: 'ok',
      item: best.item,
      sure: best.sure,
      doubt: best.item.doubt || '',
      typical: best.typical
    };
  }).catch(function (e) {
    return { status: 'error', reason: String(e && e.message || e) };
  });
};

var compare = function (payload) {
  var q = TC.buildQuery(payload.title, payload.brand);
  var anchor = Number(payload.price) > 0 ? Number(payload.price) : null;
  var targets = TC.ORDER.filter(function (s) { return s !== payload.site; });
  var key = payload.site + '|' + q.text + '|' + (anchor || 0);

  var cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  return Promise.all(targets.map(function (site) {
    return askSource(site, q, anchor).then(function (res) { return [site, res]; });
  })).then(function (pairs) {
    var out = { query: q.text, results: {} };
    pairs.forEach(function (p) { out.results[p[0]] = p[1]; });
    cacheSet(key, out);
    return out;
  });
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'compare') return;
  compare(msg).then(sendResponse).catch(function (e) {
    sendResponse({ query: '', results: {}, fatal: String(e && e.message || e) });
  });
  return true; // ответ придёт асинхронно
});
