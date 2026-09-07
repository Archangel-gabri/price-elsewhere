// Отрисовка панели. Никакого innerHTML для названий товаров — они приходят
// с чужих сайтов, поэтому только textContent.
var TC = (globalThis.TC = globalThis.TC || {});

var ARROW = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.7" '
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

var CHEVRON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M4 6.5L8 10.5L12 6.5" stroke="currentColor" stroke-width="1.7" '
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

var PANEL_PRICE_NOTE = 'Цены из поиска и карточек. Скидки банков/кошелька, доставка и пошлины могут отличаться; итог проверьте на площадке.';

var panelPrice = function (value) {
  return Number(value) > 0 ? (TC.money(value) || '—') : '—';
};

var el = function (tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

TC.Panel = {
  node: null,
  rows: {},

  destroy: function () {
    if (this.node && this.node.parentNode) this.node.parentNode.removeChild(this.node);
    this.node = null;
    this.rows = {};
  },

  /** Рисуем каркас сразу, до ответа площадок: пустая панель честнее спиннера. */
  mount: function (current, folded) {
    this.destroy();

    var panel = el('div');
    panel.id = 'tc-panel';
    if (folded) panel.className = 'tc-folded';

    // шапка
    var head = el('div', 'tc-head');
    var mark = el('div', 'tc-mark');
    TC.ORDER.forEach(function (s) {
      var i = el('img');
      i.src = TC.LOGOS[s];
      i.alt = '';
      mark.appendChild(i);
    });
    head.appendChild(mark);
    head.appendChild(el('div', 'tc-title', 'Где дешевле'));

    var fold = el('button', 'tc-fold');
    fold.innerHTML = CHEVRON;
    fold.setAttribute('aria-label', 'Свернуть');
    head.appendChild(fold);

    var self = this;
    head.addEventListener('click', function () {
      var now = panel.classList.toggle('tc-folded');
      try { chrome.storage.local.set({ folded: now }); } catch (e) {}
    });

    panel.appendChild(head);

    // строки
    var body = el('div', 'tc-body');
    TC.ORDER.forEach(function (site) {
      var isHere = site === current.site;
      var row = el(isHere ? 'div' : 'a', 'tc-row');
      if (!isHere) {
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
        row.href = TC.SITES[site].search(current.title);
      }

      var logo = el('img', 'tc-logo');
      logo.src = TC.LOGOS[site];
      logo.alt = '';
      row.appendChild(logo);

      var info = el('div', 'tc-info');
      info.appendChild(el('div', 'tc-name', TC.SITES[site].name));
      var sub = el('div', 'tc-sub');
      if (isHere) sub.textContent = current.title;
      else sub.appendChild(el('div', 'tc-skel tc-w-name'));
      info.appendChild(sub);
      row.appendChild(info);

      var right = el('div', 'tc-right');
      if (isHere) {
        right.appendChild(el('div', 'tc-price', panelPrice(current.price)));
        right.appendChild(el('div', 'tc-here', 'вы здесь'));
      } else {
        right.appendChild(el('div', 'tc-skel tc-w-price'));
      }
      row.appendChild(right);

      if (!isHere) {
        var go = el('span', 'tc-go');
        go.innerHTML = ARROW;
        row.appendChild(go);
      }

      body.appendChild(row);
      self.rows[site] = row;
    });
    panel.appendChild(body);

    // подвал
    var foot = el('div', 'tc-foot');
    foot.appendChild(el('span', 'tc-q', 'ищем на двух других площадках…'));
    foot.appendChild(el('span', 'tc-note', PANEL_PRICE_NOTE));
    panel.appendChild(foot);

    document.documentElement.appendChild(panel);
    this.node = panel;
    return panel;
  },

  /**
   * Пришли ответы площадок.
   *
   * Уверенность относится к совпадению товара. Источники не подтверждают
   * одинаковые условия оплаты и обязательные доплаты, поэтому цены показываем
   * без ранжирования и разницы в рублях даже для уверенного совпадения.
   * Похожий товар сохраняет отдельную приглушённую цену и причину сомнения.
   */
  update: function (current, data) {
    if (!this.node) return;
    var self = this;
    var results = (data && data.results) || {};

    TC.ORDER.forEach(function (site) {
      var row = self.rows[site];
      if (!row) return;
      row.classList.remove('tc-best', 'tc-doubtful');
      // Повторный ответ заменяет прежние метки, включая старую разницу цены.
      ['.tc-delta', '.tc-why'].forEach(function (selector) {
        row.querySelectorAll(selector).forEach(function (node) {
          node.parentNode.removeChild(node);
        });
      });

      if (site === current.site) return;

      var res = results[site] || { status: 'error' };
      var sub = row.querySelector('.tc-sub');
      var right = row.querySelector('.tc-right');
      sub.textContent = '';
      right.textContent = '';
      row.href = TC.SITES[site].search(current.title);
      row.title = '';

      if (res.status !== 'ok') {
        sub.textContent = res.status === 'nomatch'
          ? 'точного совпадения нет'
          : 'не удалось узнать цену';
        right.appendChild(el('div', 'tc-price tc-none', 'посмотреть'));
        return;
      }

      var it = res.item;
      row.href = it.url;
      row.title = it.title;
      sub.appendChild(el('div', 'tc-found', it.title));

      if (res.sure) {
        right.appendChild(el('div', 'tc-price', panelPrice(it.price)));
        return;
      }

      // Не уверены в совпадении товара.
      row.classList.add('tc-doubtful');
      right.appendChild(el('div', 'tc-price tc-soft', panelPrice(it.price)));

      // Пояснение — отдельной строкой во всю ширину: рядом с ценой оно
      // не помещается и обрезается на полуслове, а именно оно тут главное.
      var why = el('div', 'tc-why');
      why.appendChild(el('span', 'tc-flag', 'похожий товар'));
      var reason = [res.doubt, res.typical ? 'обычно ' + TC.money(res.typical) : '']
        .filter(Boolean).join(' · ');
      if (reason) why.appendChild(el('span', 'tc-reason', reason));
      row.appendChild(why);
    });

    var foot = this.node.querySelector('.tc-foot');
    foot.textContent = '';
    foot.appendChild(el('span', 'tc-q', 'искали: ' + (data && data.query ? data.query : current.title)));
    foot.appendChild(el('span', 'tc-note', PANEL_PRICE_NOTE));
  }
};
