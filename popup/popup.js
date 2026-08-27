// Логотипы площадок в шапке — те же, что в панели.
var mark = document.getElementById('mark');
TC.ORDER.forEach(function (s) {
  var img = document.createElement('img');
  img.src = TC.LOGOS[s];
  img.alt = TC.SITES[s].name;
  img.title = TC.SITES[s].name;
  mark.appendChild(img);
});

var sw = document.getElementById('sw');
var state = document.getElementById('state');

var paint = function (on) {
  sw.classList.toggle('on', !!on);
  state.textContent = on ? 'включено' : 'выключено';
};

chrome.storage.local.get({ enabled: true }, function (v) { paint(v.enabled); });

sw.addEventListener('click', function () {
  var next = !sw.classList.contains('on');
  paint(next);
  chrome.storage.local.set({ enabled: next });
});
