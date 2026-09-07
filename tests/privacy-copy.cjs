#!/usr/bin/env node
/** Public privacy copy must describe the marketplace requests made by sources.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const russian = read('README.ru.md');
const english = read('README.md');
const popup = read('popup/popup.html');
const sources = read('src/sources.js');
const manifest = JSON.parse(read('manifest.json'));

const section = function (document, heading) {
  const marker = '## ' + heading;
  const start = document.indexOf(marker);
  assert.notEqual(start, -1, marker + ' section must exist');
  const tail = document.slice(start + marker.length);
  const next = tail.indexOf('\n## ');
  return next < 0 ? tail : tail.slice(0, next);
};
const russianPrivacy = section(russian, 'Приватность');
const englishPrivacy = section(english, 'Privacy');

const inspectRequests = async function () {
  const calls = [];
  const context = vm.createContext({
    console,
    AbortController,
    setTimeout: function () { return 1; },
    clearTimeout: function () {},
    fetch: function (url, options) {
      calls.push({ url: url, options: options });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve(/search\.wb\.ru/.test(url) ? { products: [] } : { widgetStates: {} });
        },
        text: function () { return Promise.resolve(''); }
      });
    }
  });
  context.globalThis = context;
  vm.runInContext(read('src/config.js'), context, { filename: 'src/config.js' });
  vm.runInContext(sources, context, { filename: 'src/sources.js' });
  await Promise.all([
    context.TC.wbSearch('privacy audit'),
    context.TC.ozonSearch('privacy audit'),
    context.TC.ymSearch('privacy audit')
  ]);
  return calls;
};

const main = async function () {
  const calls = await inspectRequests();
  const requestHosts = calls.map(function (call) { return new URL(call.url).hostname; }).sort();
  const permissionHosts = (manifest.host_permissions || []).map(function (permission) {
    const match = permission.match(/^https:\/\/([^/]+)\/\*$/);
    assert.ok(match, 'marketplace host permission must be an explicit https origin');
    return match[1];
  }).sort();

  assert.equal(calls.length, 3, 'each marketplace source must issue one offline-stubbed request');
  assert.deepEqual(permissionHosts, requestHosts, 'manifest hosts must equal the actual request hosts');
  assert.equal(
    calls.every(function (call) { return call.options.credentials === 'include'; }),
    /cookies/i.test(russianPrivacy) && /cookies/i.test(englishPrivacy),
    'cookie disclosure must track the effective fetch credentials policy'
  );

  assert.doesNotMatch(russianPrivacy, /Ничего никуда не отправляется/i);
  assert.match(russianPrivacy, /поисковый запрос отправляется напрямую/i);
  assert.match(russianPrivacy, /cookies/i);
  assert.match(russianPrivacy, /Ничего не хранится постоянно/i);
  assert.match(
    russianPrivacy,
    /кэшируются только в оперативной памяти service worker и повторно используются не более десяти минут/i,
    'cache copy must describe reuse TTL without promising eager physical deletion'
  );
  assert.doesNotMatch(englishPrivacy, /Nothing is sent anywhere/i);
  assert.match(englishPrivacy, /search query is sent directly/i);
  assert.match(englishPrivacy, /cookies/i);
  assert.match(englishPrivacy, /Nothing is persistently stored/i);
  assert.match(
    englishPrivacy,
    /cached in volatile service-worker memory and reused for no more than ten minutes/i,
    'cache copy must describe reuse TTL without promising eager physical deletion'
  );
  assert.doesNotMatch(popup, /Ничего[^<]*никуда не отправляет/i);
  assert.match(popup, /поисковые запросы уходят напрямую/i);
  requestHosts.forEach(function (host) {
    assert.match(russianPrivacy, new RegExp(host.replace(/\./g, '\\.')));
    assert.match(englishPrivacy, new RegExp(host.replace(/\./g, '\\.')));
  });
  console.log('  PASS  public privacy copy matches effective marketplace requests');
};

main().catch(function (error) {
  console.error('  FAIL  public privacy copy matches effective marketplace requests');
  console.error(error);
  process.exitCode = 1;
});
