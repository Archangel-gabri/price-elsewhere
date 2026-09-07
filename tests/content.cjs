#!/usr/bin/env node
/** Offline content-script lifecycle regressions. No DOM or network is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const runScenario = function (priceAtDetection) {
  const intervals = [];
  const clearedIntervals = new Set();
  const sentPrices = [];
  const mountedPrices = [];
  const updatedPrices = [];
  let detections = 0;

  const context = vm.createContext({
    console,
    location: {
      href: 'https://www.ozon.ru/product/demo-123456/',
      hostname: 'www.ozon.ru',
      pathname: '/product/demo-123456/'
    },
    setInterval: function (callback) {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval: function (id) {
      if (id != null) clearedIntervals.add(id);
    },
    TC: {
      detect: function () {
        detections++;
        return {
          site: 'ozon',
          id: '123456',
          title: 'Demo product',
          price: priceAtDetection(detections),
          brand: 'Demo'
        };
      },
      Panel: {
        destroy: function () {},
        mount: function (current) { mountedPrices.push(current.price); },
        update: function (current) { updatedPrices.push(current.price); }
      }
    },
    chrome: {
      storage: {
        local: {
          get: function (_defaults, callback) {
            callback({ enabled: true, folded: false });
          }
        },
        onChanged: { addListener: function () {} }
      },
      runtime: {
        lastError: null,
        sendMessage: function (payload, callback) {
          sentPrices.push(payload.price);
          callback({ results: {} });
        }
      }
    }
  });
  context.globalThis = context;

  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8'),
    context,
    { filename: 'src/content.js' }
  );

  assert.equal(intervals.length, 2, 'content script should start one retry and one URL watcher');
  return {
    sentPrices,
    mountedPrices,
    updatedPrices,
    retryStopped: function () { return clearedIntervals.has(1); },
    detectionCount: function () { return detections; },
    tickRetry: function () {
      if (!clearedIntervals.has(1)) intervals[0]();
    }
  };
};

const neverPriced = runScenario(function () { return null; });
for (let i = 0; i < 60; i++) neverPriced.tickRetry();
assert.equal(neverPriced.detectionCount(), 42, 'initial detection plus 41 bounded retries');
assert.deepEqual(neverPriced.sentPrices, [null], 'pending state must be compared only once');
assert.equal(neverPriced.retryStopped(), true, 'never-priced product must stop retrying');
console.log('  PASS  missing price retries are bounded without duplicate compares');

const boundaryPrice = runScenario(function (detection) {
  return detection < 42 ? null : 999;
});
for (let i = 0; i < 60; i++) boundaryPrice.tickRetry();
assert.equal(boundaryPrice.detectionCount(), 42, 'price may appear on the final allowed retry');
assert.deepEqual(
  boundaryPrice.sentPrices,
  [null, 999],
  'the final allowed retry must compare the late-rendered price exactly once'
);
assert.deepEqual(boundaryPrice.mountedPrices, [null, 999]);
assert.deepEqual(boundaryPrice.updatedPrices, [null, 999]);
assert.equal(boundaryPrice.retryStopped(), true);
console.log('  PASS  boundary late-rendered price refreshes the product exactly once');
