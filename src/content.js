// Точка входа. Ждём, пока карточка товара отрисуется, показываем панель,
// спрашиваем у service worker цены на двух других площадках.
(function () {
  var TC = globalThis.TC;
  var lastKey = null;
  var timer = null;

  var settings = { enabled: true, folded: false };

  var run = function () {
    var current = TC.detect();
    if (!current) return false;

    var key = current.site + ':' + current.id;
    if (key === lastKey) return true;
    lastKey = key;

    if (!settings.enabled) { TC.Panel.destroy(); return true; }

    TC.Panel.mount(current, settings.folded);

    try {
      chrome.runtime.sendMessage(
        { type: 'compare', site: current.site, title: current.title, price: current.price, brand: current.brand },
        function (data) {
          if (chrome.runtime.lastError) return; // service worker уснул — молча
          if (lastKey !== key) return;          // юзер уже ушёл на другой товар
          TC.Panel.update(current, data || {});
        }
      );
    } catch (e) { /* расширение перезагрузили — панель просто останется пустой */ }

    return true;
  };

  // Карточка на Ozon и Маркете дорисовывается после загрузки страницы,
  // поэтому пробуем несколько раз, а не один.
  var waitAndRun = function () {
    var tries = 0;
    clearInterval(timer);
    timer = setInterval(function () {
      tries++;
      if (run() || tries > 40) clearInterval(timer);
    }, 500);
    run();
  };

  // Все три площадки — SPA: адрес меняется без перезагрузки.
  var watchUrl = function () {
    var prev = location.href;
    setInterval(function () {
      if (location.href === prev) return;
      prev = location.href;
      lastKey = null;
      TC.Panel.destroy();
      waitAndRun();
    }, 700);
  };

  try {
    chrome.storage.local.get({ enabled: true, folded: false }, function (v) {
      settings = v;
      waitAndRun();
      watchUrl();
    });

    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.enabled) {
        settings.enabled = changes.enabled.newValue;
        lastKey = null;
        TC.Panel.destroy();
        if (settings.enabled) waitAndRun();
      }
      if (changes.folded) settings.folded = changes.folded.newValue;
    });
  } catch (e) {
    waitAndRun();
    watchUrl();
  }
})();
