#!/usr/bin/env node
/** Offline service-worker regressions. No browser or network is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const load = (file) => vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, file), 'utf8'),
  { filename: file }
);

for (const file of ['src/config.js', 'src/query.js', 'src/pick.js']) load(file);

globalThis.importScripts = function () {};
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: function () {} }
  }
};

load('src/background.js');

const catalog = function () {
  return [
    {
      title: 'Acme Power Bank PBX 10000mAh',
      price: 5000,
      brand: 'Acme',
      reviews: 10,
      url: 'https://example.test/pbx-10000'
    },
    {
      title: 'Acme Power Bank PBX 20000mAh',
      price: 5000,
      brand: 'Acme',
      reviews: 10,
      url: 'https://example.test/pbx-20000'
    }
  ];
};

const transientErrorsAreRetried = async function () {
  let calls = 0;
  TC.SEARCH = {
    wb: function () { calls++; return Promise.reject(new Error('temporary wb failure')); },
    ym: function () { calls++; return Promise.reject(new Error('temporary ym failure')); }
  };
  const payload = {
    type: 'compare',
    site: 'ozon',
    title: 'Acme transient gadget TST900',
    price: 9000,
    brand: 'Acme'
  };

  const failed = await compare(payload);
  assert.deepEqual(
    Object.values(failed.results).map(function (result) { return result.status; }),
    ['error', 'error']
  );

  TC.SEARCH = {
    wb: function () { calls++; return Promise.resolve([]); },
    ym: function () { calls++; return Promise.resolve([]); }
  };
  const retried = await compare(payload);

  assert.equal(calls, 4, 'a transient aggregate must not occupy the success cache');
  assert.deepEqual(
    Object.values(retried.results).map(function (result) { return result.status; }),
    ['nomatch', 'nomatch']
  );
  console.log('  PASS  transient source errors are retried instead of cached');
};

const partialErrorsAreRetried = async function () {
  let calls = 0;
  const partialCatalog = function () {
    return [{
      title: 'Acme Partial Gadget PRT901',
      price: 9000,
      brand: 'Acme',
      reviews: 10,
      url: 'https://example.test/prt901'
    }];
  };
  const payload = {
    type: 'compare',
    site: 'ozon',
    title: 'Acme Partial Gadget PRT901',
    price: 9000,
    brand: 'Acme'
  };

  TC.SEARCH = {
    wb: function () { calls++; return Promise.resolve(partialCatalog()); },
    ym: function () { calls++; return Promise.reject(new Error('temporary ym failure')); }
  };
  const partial = await compare(payload);
  assert.equal(partial.results.wb.status, 'ok');
  assert.equal(partial.results.ym.status, 'error');

  TC.SEARCH = {
    wb: function () { calls++; return Promise.resolve(partialCatalog()); },
    ym: function () { calls++; return Promise.resolve(partialCatalog()); }
  };
  const complete = await compare(payload);
  assert.equal(calls, 4, 'one successful source must not make a partial aggregate cacheable');
  assert.equal(complete.results.wb.status, 'ok');
  assert.equal(complete.results.ym.status, 'ok');

  const cached = await compare(payload);
  assert.equal(calls, 4, 'the complete aggregate should still use the success cache');
  assert.deepEqual(cached, complete);
  console.log('  PASS  partial success is returned but its transient peer is retried');
};

const reversePartialErrorsAreRetried = async function () {
  let calls = 0;
  const partialCatalog = function () {
    return [{
      title: 'Acme Reverse Partial Gadget RPT902',
      price: 9000,
      brand: 'Acme',
      reviews: 10,
      url: 'https://example.test/rpt902'
    }];
  };
  const payload = {
    type: 'compare',
    site: 'ozon',
    title: 'Acme Reverse Partial Gadget RPT902',
    price: 9000,
    brand: 'Acme'
  };

  TC.SEARCH = {
    wb: function () { calls++; return Promise.reject(new Error('temporary wb failure')); },
    ym: function () { calls++; return Promise.resolve(partialCatalog()); }
  };
  const partial = await compare(payload);
  assert.equal(partial.results.wb.status, 'error');
  assert.equal(partial.results.ym.status, 'ok');

  TC.SEARCH = {
    wb: function () { calls++; return Promise.resolve(partialCatalog()); },
    ym: function () { calls++; return Promise.resolve(partialCatalog()); }
  };
  const complete = await compare(payload);
  assert.equal(calls, 4, 'a first-source error must make the mixed aggregate non-cacheable');
  assert.equal(complete.results.wb.status, 'ok');
  assert.equal(complete.results.ym.status, 'ok');
  console.log('  PASS  reverse partial source errors are retried instead of cached');
};

const expiredEntriesArePurged = async function () {
  const realNow = Date.now;
  let now = 1000;
  Date.now = function () { return now; };
  cache.clear();
  TC.SEARCH = {
    wb: function () { return Promise.resolve([]); },
    ym: function () { return Promise.resolve([]); }
  };

  try {
    await compare({
      type: 'compare', site: 'ozon', title: 'Acme Cache Item CCH100', price: 1000, brand: 'Acme'
    });
    assert.equal(cache.size, 1);

    now += TC.CACHE_TTL_MS + 1;
    await compare({
      type: 'compare', site: 'ozon', title: 'Acme Other Cache Item CCH200', price: 1000, brand: 'Acme'
    });
    assert.equal(
      cache.size,
      1,
      'an unrelated cache operation must physically purge entries older than the disclosed TTL'
    );
  } finally {
    Date.now = realNow;
    cache.clear();
  }
  console.log('  PASS  expired search answers are physically purged on cache operations');
};

const expiredSameKeyIsRefetched = async function () {
  const realNow = Date.now;
  let now = 1000;
  let calls = 0;
  const payload = {
    type: 'compare', site: 'ozon', title: 'Acme Cache Boundary CCH300', price: 1000, brand: 'Acme'
  };
  Date.now = function () { return now; };
  cache.clear();
  TC.SEARCH = {
    wb: function () { calls++; return Promise.resolve([]); },
    ym: function () { calls++; return Promise.resolve([]); }
  };

  try {
    await compare(payload);
    assert.equal(calls, 2);

    now += TC.CACHE_TTL_MS;
    await compare(payload);
    assert.equal(calls, 2, 'an entry is reusable at the exact TTL boundary');

    now += 1;
    await compare(payload);
    assert.equal(calls, 4, 'the same key must be fetched again immediately after TTL');
  } finally {
    Date.now = realNow;
    cache.clear();
  }
  console.log('  PASS  same-key cache hits stop immediately after the disclosed TTL');
};

const cacheSizeIsBounded = function () {
  const realNow = Date.now;
  let now = 1000;
  Date.now = function () { return now++; };
  cache.clear();

  try {
    for (let i = 0; i <= 120; i++) cacheSet('bounded-' + i, i);
    assert.equal(cache.size, 120, 'the in-memory cache must stay bounded at 120 entries');
    assert.equal(cache.has('bounded-0'), false, 'the oldest entry must be evicted first');
    assert.equal(cache.get('bounded-120').value, 120, 'the newest entry must be retained');
  } finally {
    Date.now = realNow;
    cache.clear();
  }
  console.log('  PASS  cache retains at most 120 entries and evicts the oldest');
};

const cacheSetPurgesExpiredEntries = function () {
  const realNow = Date.now;
  let now = 1000;
  Date.now = function () { return now; };
  cache.clear();

  try {
    cacheSet('expired-before-write', 'old');
    now += TC.CACHE_TTL_MS + 1;
    cacheSet('fresh-write', 'new');
    assert.equal(cache.size, 1, 'a write must purge older expired entries before insertion');
    assert.equal(cache.has('expired-before-write'), false);
    assert.equal(cache.get('fresh-write').value, 'new');
  } finally {
    Date.now = realNow;
    cache.clear();
  }
  console.log('  PASS  cache writes purge expired entries before insertion');
};

const main = async function () {
  let calls = 0;
  TC.SEARCH = {
    wb: function () { calls++; return Promise.resolve(catalog()); },
    ym: function () { calls++; return Promise.resolve(catalog()); }
  };

  const first = await compare({
    type: 'compare',
    site: 'ozon',
    title: 'Acme Power Bank PBX 10000mAh',
    price: 5000,
    brand: 'Acme'
  });
  const second = await compare({
    type: 'compare',
    site: 'ozon',
    title: 'Acme Power Bank PBX 20000mAh',
    price: 5000,
    brand: 'Acme'
  });

  assert.match(first.results.wb.item.title, /10000mAh/);
  assert.match(second.results.wb.item.title, /20000mAh/);
  assert.equal(calls, 4, 'different specifications must not share a cache entry');
  console.log('  PASS  cache separates products with different specifications');
  await transientErrorsAreRetried();
  await partialErrorsAreRetried();
  await reversePartialErrorsAreRetried();
  await expiredEntriesArePurged();
  await expiredSameKeyIsRefetched();
  cacheSizeIsBounded();
  cacheSetPurgesExpiredEntries();
};

main().catch(function (error) {
  console.error('  FAIL  background regression');
  console.error(error);
  process.exitCode = 1;
});
