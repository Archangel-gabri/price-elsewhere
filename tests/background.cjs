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
};

main().catch(function (error) {
  console.error('  FAIL  cache separates products with different specifications');
  console.error(error);
  process.exitCode = 1;
});
