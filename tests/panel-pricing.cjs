#!/usr/bin/env node
/** Execute the production renderer against a small DOM tree; no browser or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this._text = '';
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: (name) => classes().has(name),
      add: (...names) => { this.className = [...new Set([...classes(), ...names])].join(' '); },
      remove: (...names) => { this.className = [...classes()].filter((name) => !names.includes(name)).join(' '); },
      toggle: (name) => {
        const present = this.classList.contains(name);
        this.classList[present ? 'remove' : 'add'](name);
        return !present;
      }
    };
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    assert.notEqual(index, -1, 'removeChild requires an attached child');
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  set textContent(value) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this._text = String(value);
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener() {}
  querySelectorAll(selector) {
    assert.match(selector, /^\.[a-z-]+$/, 'the harness supports class selectors only');
    const found = [];
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const ROOT = path.join(__dirname, '..');
const NOTE = 'Цены из поиска и карточек. Скидки банков/кошелька, доставка и пошлины могут отличаться; итог проверьте на площадке.';
const current = (extra = {}) => ({ site: 'ozon', title: 'Samsung Galaxy A55 8GB 256GB', price: 32345, ...extra });
const offer = (extra = {}) => ({
  status: 'ok', sure: true,
  item: { title: 'Samsung Galaxy A55 8GB 256GB', price: 36951, url: 'https://market.yandex.ru/card/a55/123456' },
  ...extra
});
const setup = (product = current()) => {
  const document = { createElement: (tag) => new Element(tag), documentElement: new Element('html') };
  const context = vm.createContext({ document, chrome: { storage: { local: { set() {} } } } });
  for (const file of ['src/config.js', 'src/panel.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  context.TC.LOGOS = { ozon: 'ozon.svg', wb: 'wb.svg', ym: 'ym.svg' };
  const panel = context.TC.Panel;
  panel.mount(product, false);
  return { panel, tc: context.TC, product };
};
const assertNote = (panel) => {
  assert.equal(panel.node.querySelectorAll('.tc-note').length, 1);
  assert.equal(panel.node.querySelector('.tc-note').textContent, NOTE);
};
const assertNoComparison = (panel) => {
  for (const cls of ['tc-best', 'tc-delta', 'tc-win', 'tc-lose']) {
    assert.equal(panel.node.querySelectorAll('.' + cls).length, 0, cls + ' must not claim comparable prices');
  }
  assert.doesNotMatch(panel.node.textContent, /столько же|[+−]\s*4\s?606/);
};
let passed = 0, failed = 0;
const test = (name, run) => {
  try { run(); passed++; console.log('  PASS  ' + name); }
  catch (error) { failed++; console.error('  FAIL  ' + name + '\n' + error.message); }
};

test('initial panel discloses price conditions before source responses', () => {
  const { panel, tc, product } = setup();
  assert.equal(panel.rows.ozon.querySelector('.tc-price').textContent, tc.money(32345));
  assert.equal(panel.rows.ym.href, tc.SITES.ym.search(product.title));
  assertNote(panel);
  assertNoComparison(panel);
});

test('live conditional Ozon price and sure Yandex offer preserve numbers and links without savings', () => {
  const { panel, tc, product } = setup(current({ priceBasis: 'conditional' }));
  const result = offer();
  panel.update(product, { results: { ym: result } });
  assert.equal(panel.rows.ozon.querySelector('.tc-price').textContent, tc.money(32345));
  assert.equal(panel.rows.ym.querySelector('.tc-price').textContent, tc.money(36951));
  assert.equal(panel.rows.ym.href, result.item.url);
  assert.equal(panel.rows.ym.title, result.item.title);
  assertNoComparison(panel);
  assertNote(panel);
});

test('missing price metadata does not enable comparison for sure matches', () => {
  const { panel, product } = setup();
  panel.update(product, { results: { ym: offer() } });
  assertNoComparison(panel);
  assertNote(panel);
});

test('equal conditional prices do not claim the same purchase cost', () => {
  const { panel, product } = setup(current({ priceBasis: 'conditional' }));
  const result = offer();
  result.item.price = product.price;
  result.item.priceBasis = 'conditional';
  panel.update(product, { results: { ym: result } });
  assertNoComparison(panel);
  assertNote(panel);
});

test('price metadata cannot opt into ranking without a verified comparison contract', () => {
  const { panel, product } = setup(current({ priceBasis: 'comparable' }));
  const result = offer();
  result.item.priceBasis = 'comparable';
  panel.update(product, { results: { ym: result } });
  assertNoComparison(panel);
});

test('zero and missing current prices remain unavailable without comparison', () => {
  for (const price of [0, null, undefined]) {
    const { panel, product } = setup(current({ price }));
    panel.update(product, { results: { ym: offer() } });
    assert.equal(panel.rows.ozon.querySelector('.tc-price').textContent, '—');
    assertNoComparison(panel);
    assertNote(panel);
  }
});

test('zero and missing offer prices are not presented as free or blank', () => {
  for (const price of [0, null, undefined]) {
    const { panel, product } = setup();
    const result = offer();
    result.item.price = price;
    panel.update(product, { results: { ym: result } });
    assert.equal(panel.rows.ym.querySelector('.tc-price').textContent, '—');
    assertNoComparison(panel);
    assertNote(panel);
  }
});

test('product uncertainty and its reason survive alongside the price warning', () => {
  const { panel, product } = setup();
  panel.update(product, { results: { ym: offer({ sure: false, doubt: 'б/у или уценка' }) } });
  assert.equal(panel.rows.ym.querySelector('.tc-flag').textContent, 'похожий товар');
  assert.equal(panel.rows.ym.querySelector('.tc-reason').textContent, 'б/у или уценка');
  assert.equal(panel.rows.ym.classList.contains('tc-doubtful'), true);
  assertNoComparison(panel);
  assertNote(panel);
});

test('repeated weak updates have one reason and clear stale comparative markup', () => {
  const { panel, product } = setup();
  for (const row of Object.values(panel.rows)) {
    row.classList.add('tc-best');
    const stale = new Element('div');
    stale.className = 'tc-delta tc-win';
    stale.textContent = '−4 606 ₽';
    row.querySelector('.tc-right').appendChild(stale);
  }
  const data = { results: { ym: offer({ sure: false, doubt: 'другой бренд' }) } };
  panel.update(product, data);
  panel.update(product, data);
  assert.equal(panel.rows.ym.querySelectorAll('.tc-why').length, 1);
  assertNoComparison(panel);
  assertNote(panel);
});

test('weak to sure update removes the old product warning without adding price ranking', () => {
  const { panel, product } = setup();
  panel.update(product, { results: { ym: offer({ sure: false, doubt: 'другой бренд' }) } });
  panel.update(product, { results: { ym: offer() } });
  assert.equal(panel.rows.ym.querySelectorAll('.tc-why').length, 0);
  assert.equal(panel.rows.ym.classList.contains('tc-doubtful'), false);
  assertNoComparison(panel);
  assertNote(panel);
});

test('nomatch and error keep truthful text and reset stale offer links to search', () => {
  const { panel, tc, product } = setup();
  panel.update(product, { results: { ym: offer({ sure: false, doubt: 'другой бренд' }) } });
  panel.update(product, { results: { ym: { status: 'nomatch' }, wb: { status: 'error' } } });
  assert.equal(panel.rows.ym.querySelector('.tc-sub').textContent, 'точного совпадения нет');
  assert.equal(panel.rows.wb.querySelector('.tc-sub').textContent, 'не удалось узнать цену');
  assert.equal(panel.rows.ym.href, tc.SITES.ym.search(product.title));
  assert.equal(panel.rows.ym.title, '');
  assert.equal(panel.rows.ym.querySelectorAll('.tc-why').length, 0);
  assertNoComparison(panel);
  assertNote(panel);
});

test('empty source response still discloses price limitations', () => {
  const { panel, product } = setup();
  panel.update(product, {});
  assert.equal(panel.rows.ym.querySelector('.tc-sub').textContent, 'не удалось узнать цену');
  assertNoComparison(panel);
  assertNote(panel);
});

console.log('ИТОГ panel pricing: ' + passed + ' прошло, ' + failed + ' упало');
if (failed) process.exitCode = 1;
