// Название товара -> поисковый запрос + оценка «тот ли это товар».
//
// Общего идентификатора у площадок нет: у WB свой nmId, у Ozon свой SKU,
// у Маркета свой. Штрихкода и артикула производителя они наружу не отдают
// (проверено). Значит единственное, что у нас есть, — текст названия,
// и всю точность приходится вытаскивать из него.
var TC = (globalThis.TC = globalThis.TC || {});

// Слова, которые есть в каждом втором названии и ничего не различают.
TC.NOISE = new Set((
  'и,в,на,для,с,со,из,по,от,до,или,а,же,шт,штук,упаковка,набор,комплект,' +
  'новый,новая,новое,оригинал,оригинальный,оригинальные,официальная,официальный,' +
  'гарантия,гарантией,качество,качества,premium,премиум,люкс,топ,хит,акция,распродажа,' +
  'мужской,мужская,мужские,женский,женская,женские,детский,детская,детские,унисекс,' +
  'подарок,подарочный,подарочная,подарочные,подарком,бесплатная,доставка,' +
  'россия,российский,импорт,европа,китай,еврокачество,eu,ru,rus,global,' +
  'размер,размеры,цвет,цвета,расцветка,модель,серия,артикул,' +
  'беспроводные,беспроводной,беспроводная,проводные,проводной,портативный,портативная,' +
  'большие,маленькие,удобный,удобные,стильный,стильные,модный,модные,красивый,красивые,' +
  'лучший,лучшие,недорогой,недорогие,дешевый,дешевые,профессиональный,профессиональная,' +
  'универсальный,универсальная,универсальные,мощный,мощная,прочный,прочная,' +
  // технические слова: стоят в каждом названии категории и только сбивают поиск
  'bluetooth,блютуз,wifi,вайфай,usb,type,typec,micro,mini,hdmi,jack,aux,nfc,anc,tws,' +
  // pro/max/plus/ultra сюда НЕ добавляем: это часть названия модели,
  // без них iPhone 15 Pro Max склеится с обычным iPhone 15.
  'led,lcd,ips,oled,amoled,hd,fhd,uhd,mah,' +
  'накладные,вкладыши,внутриканальные,гарнитура,микрофоном,микрофон,наушники,' +
  'см,мм,м,кг,г,мл,л,вт,ватт,гб,тб,мб,gb,tb,ram,гц'
).split(','));

// Цвет почти никогда не меняет цену, но сильно сужает выдачу. Выкидываем.
TC.COLORS = new Set((
  'черный,чёрный,черная,чёрная,черные,чёрные,черное,белый,белая,белые,белое,' +
  'красный,красная,красные,синий,синяя,синие,голубой,голубая,зеленый,зелёный,зеленая,' +
  'желтый,жёлтый,желтая,серый,серая,серые,серебристый,серебряный,золотой,золотистый,' +
  'розовый,розовая,фиолетовый,фиолетовая,бежевый,бежевая,коричневый,коричневая,' +
  'оранжевый,бирюзовый,мятный,сиреневый,бордовый,хаки,графит,графитовый,' +
  'black,white,red,blue,green,grey,gray,silver,gold,pink,purple,beige,brown,navy'
).split(','));

// Аксессуар к товару стоит в разы дешевле самого товара и всегда лезет в выдачу
// по его названию. Если у нас телефон, а нашёлся чехол — это не «дешевле».
TC.ACCESSORY = /чехол|кейс|футляр|амбушюр|накладк|защитн|плёнк|пленк|стекло|подставк|держател|кабел|переходник|адаптер|шнур|сумк|ремешок|наклейк|запасн|сменн|комплект насадок/i;

// Искать эти слова по всему названию нельзя: «Повербанк CR11 20000mAh, 100W,
// с кабелем USB-C» — это повербанк, а не кабель, и отбрасывать его нельзя.
// Тип товара на маркетплейсах почти всегда стоит в самом начале названия,
// а комплектация — в хвосте. Поэтому смотрим только начало.
TC.HEAD_LEN = 45;

TC.isAccessory = function (title) {
  return TC.ACCESSORY.test(String(title || '').slice(0, TC.HEAD_LEN));
};

// ВНИМАНИЕ про \b и \w в регулярках ниже.
// В JavaScript граница слова \b и класс \w определены только по ASCII:
// кириллица для них — не буквы. Поэтому /мАч\b/ не срабатывает никогда,
// и вся сверка характеристик на русских названиях молча умирает.
// Вместо \b здесь всюду явные просмотры (?<![а-яё]) / (?![a-zа-яё0-9]).
var NB = '(?![a-zа-яё0-9])'; // «дальше не буква и не цифра» — замена \b

// Число перед единицей измерения. Пробел внутри допускается только как
// разделитель тысяч («20 000 мАч»), иначе в «Bipow 2 20000mah» захватится
// «2 20000» и получится 220000 мАч — товар отбросится как другая ёмкость.
// (?<!\d) не даёт начать разбор с середины числа.
var NUM = '(?<![\\d.,])(\\d{1,3}(?:[\\s\\u00A0\\u2009]\\d{3})*|\\d+)';

// Для памяти, штук и ватт пробел разделителем тысяч не бывает: «1 024 ГБ»
// никто не пишет. Зато бывает «iPhone 15 128 ГБ» — и разделитель тысяч
// прочитал бы это как 15128 ГБ.
var NUM_PLAIN = '(?<![\\d.,])(\\d+)';

// Продавец сам пометил товар как копию. Формулировки такие, чтобы площадка
// не сняла карточку, — отсюда «1:1», «люкс качество», «по мотивам».
// Если это есть в названии, сравнивать нечего.
TC.FAKE = /реплик|копи[яйию](?![а-яё])|подделк|дубликат|(?<!\d)1\s*[:xх]\s*1(?!\d)|по\s+мотивам|не\s*оригинал|неоригинал|люкс\s*(?:кач|копи)|premium\s*копи|(?<![а-яё])аналог(?![а-яё])|(?<![а-яё])под\s+бренд/i;

// Товар тот же, но состояние другое. Цена законно ниже, сравнивать с новым
// нельзя — но и выбрасывать жалко, показываем с оговоркой.
// «царапины» и «дефекты» сюда не берём: чаще всего они стоят в названии
// с отрицанием («без царапин»), и получается ложная метка.
TC.USED = /(?<![а-яё])б\s*\/?\s*у(?![а-яё])|бывш[а-яё]*\s+в\s+употр|восстановл|refurbish|уценк|витринн|без\s+(?:коробк|упаковк)|некондиц|распакованн/i;

// Характеристики, которые пишут прямо в названии. Расхождение здесь — самая
// частая причина, по которой «тот же» товар вдруг вдвое дешевле: это просто
// другая ёмкость, другая память, другой объём.
TC.SPECS = [
  { key: 'mah',   label: 'ёмкость',    hard: true,  re: new RegExp(NUM + '\\s*(?:м\\s?а\\s?ч|mah)' + NB, 'i') },
  { key: 'gb',    label: 'память',     hard: true,  re: new RegExp(NUM_PLAIN + '\\s*(?:гб|gb|гигабайт)' + NB, 'i') },
  { key: 'tb',    label: 'память',     hard: true,  re: new RegExp(NUM_PLAIN + '\\s*(?:тб|tb)' + NB, 'i') },
  { key: 'ml',    label: 'объём',      hard: true,  re: new RegExp(NUM + '\\s*(?:мл|ml)' + NB, 'i') },
  { key: 'lit',   label: 'объём',      hard: true,  re: new RegExp('(?<![\\d.,])(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:литр[а-яё]*|л|l)' + NB, 'i') },
  { key: 'gram',  label: 'вес',        hard: true,  re: new RegExp(NUM + '\\s*(?:грамм[а-яё]*|гр|г|g)' + NB, 'i') },
  { key: 'watt',  label: 'мощность',   hard: false, re: new RegExp('(?<![\\d.,])(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*(?:вт|w)' + NB, 'i') },
  { key: 'count', label: 'количество', hard: true,  re: new RegExp('(?:набор|комплект|упаковк[а-яё]*|уп\\.?)\\s*(?:из\\s*)?(\\d{1,2})(?!\\d)|(?<![\\d.,])(\\d{1,2})\\s*(?:шт|штук[а-яё]*)' + NB, 'i') }
];

TC.tokenize = function (s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
};

TC.flatten = function (s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
};

// -- Похожесть двух названий ----------------------------------------------
// Коэффициент Дайса по парам букв. В отличие от расстояния Левенштейна ему
// безразличен порядок слов, а на маркетплейсах он всегда разный:
// «кофе растворимый Jacobs» и «Jacobs кофе растворимый» — одно и то же.
var bigrams = function (s) {
  var m = Object.create(null);
  for (var i = 0; i < s.length - 1; i++) {
    var b = s.substr(i, 2);
    m[b] = (m[b] || 0) + 1;
  }
  return m;
};

TC.similarity = function (a, b) {
  var x = TC.flatten(a), y = TC.flatten(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  var mx = bigrams(x), my = bigrams(y), hit = 0, total = 0, k;
  for (k in mx) total += mx[k];
  for (k in my) {
    total += my[k];
    if (mx[k]) hit += Math.min(mx[k], my[k]);
  }
  return total ? (2 * hit) / total : 0;
};

// -- Характеристики из названия -------------------------------------------

// Артикулы вида AP256GAS350XR-1, NT01N600S-256G-S3X содержат числа, которые
// выглядят как характеристики: без этой чистки «256G» внутри артикула
// прочитается как 256 ГБ памяти, и два одинаковых товара разойдутся.
var stripArticles = function (s) {
  return String(s)
    .replace(/[a-z0-9]{2,}[-–_/][a-z0-9][a-z0-9\-–_/]{2,}/gi, ' ')
    .replace(/[a-z]{2,}\d{3,}[a-z][a-z0-9]*/gi, ' ');
};

TC.parseSpecs = function (title) {
  var s = stripArticles(String(title || '')).toLowerCase().replace(/ё/g, 'е');
  var out = {};
  TC.SPECS.forEach(function (spec) {
    var m = s.match(spec.re);
    if (!m) return;
    var raw = m[1] != null ? m[1] : m[2];
    if (raw == null) return;
    var n = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
    if (isFinite(n) && n > 0) out[spec.key] = n;
  });
  return out;
};

/** Первое расхождение характеристик, либо null. */
TC.specConflict = function (a, b) {
  for (var i = 0; i < TC.SPECS.length; i++) {
    var sp = TC.SPECS[i], k = sp.key;
    if (a[k] == null || b[k] == null) continue;
    if (Math.abs(a[k] - b[k]) < 1e-9) continue;
    return { key: k, label: sp.label, hard: sp.hard, ours: a[k], theirs: b[k] };
  }

  // Один и тот же SSD пишут как 1 ТБ, 1000 ГБ или 1024 ГБ. Если единицы
  // разные, обычный проход выше не видит общего ключа и молча принимает
  // даже 1 ТБ за 512 ГБ. Сравниваем кросс-единицы, но принимаем оба
  // распространённых обозначения терабайта.
  var tb = null, gb = null, ours = null, theirs = null;
  if (a.tb != null && a.gb == null && b.gb != null && b.tb == null) {
    tb = a.tb; gb = b.gb; ours = a.tb; theirs = b.gb;
  } else if (a.gb != null && a.tb == null && b.tb != null && b.gb == null) {
    tb = b.tb; gb = a.gb; ours = a.gb; theirs = b.tb;
  }
  if (tb != null && gb !== tb * 1000 && gb !== tb * 1024) {
    return { key: 'storage', label: 'память', hard: true, ours: ours, theirs: theirs };
  }
  return null;
};

var isLatin = function (t) { return /^[a-z]+$/.test(t); };

// Сильный признак модели: буквы и цифры вместе. "520bt", "s10", "1000xm5".
// Такой токен обязан найтись в чужом названии, иначе это другой товар.
var isStrongModel = function (t) { return /\d/.test(t) && /[a-zа-я]/.test(t) && t.length >= 2; };

// «20w», «20вт», «20000mah» — это не код модели, а характеристика, и пишут её
// то латиницей, то кириллицей. Требовать её дословного совпадения нельзя:
// карточка с «20 Вт» не найдёт карточку с «20W», хотя товар тот же.
// Само значение всё равно сверяется отдельно, через TC.SPECS.
// После этих слов идёт не наш товар, а тот, с чем наш совместим.
var COMPAT = new Set('для,под,for,совместим,совместимый,совместимые,совместимая,подходит'.split(','));

var isUnitToken = function (t) {
  return /^\d+(?:вт|w|мач|mah|гб|gb|тб|tb|мл|ml|мм|mm|см|cm|кг|kg|г|g|л|l)$/.test(t);
};

// Числа в названии почти всегда и есть то, что различает товары:
// AirPods Pro 2 против Pro 3, 128 ГБ против 256, повербанк 20000 против 10000.
// Раньше они выкидывались из запроса, и «Pro 2» уверенно находил «Pro 3».
// Год выпуска — исключение, он ничего не различает.
var isNumber = function (t) { return /^\d{1,6}$/.test(t) && !/^(19|20)\d\d$/.test(t); };

/**
 * Название товара -> запрос и всё, что понадобится для сверки.
 * brand — если площадка отдала его отдельным полем, это надёжнее,
 *         чем угадывать бренд из названия.
 */
TC.buildQuery = function (title, brand) {
  var raw = String(title || '').replace(/\([^)]*\)/g, ' '); // скобки — это почти всегда артикул

  // «20 000mAh» токенизатор рвёт на «20» и «000mah», и в обязательные слова
  // попадает бессмысленный «000mah», которого нет ни в одной чужой карточке.
  // Схлопываем разделитель тысяч — но только там, где он вообще бывает:
  // «iPhone 15 128 ГБ» это модель 15 и память 128, а не 15128.
  raw = raw.replace(
    /(\d)[\s  ](?=\d{3}\s*(?:м\s?а\s?ч|mah|мл|ml|грамм|гр|г(?![а-яё])|₽|руб))/gi, '$1');

  var rawToks = TC.tokenize(raw);

  // «Повербанк для iPhone» — это повербанк, а не айфон. Слово после «для»
  // означает совместимость, и в запросе оно уводит поиск совсем не туда.
  // Но у чехла «для iPhone 15» это единственная примета товара, поэтому
  // выбрасываем совместимость, только если у товара есть свой код модели.
  var skip = {};
  for (var k = 0; k < rawToks.length - 1; k++) {
    if (COMPAT.has(rawToks[k])) skip[k + 1] = 1;
  }
  var ownModel = rawToks.some(function (t, i) { return !skip[i] && isStrongModel(t); });

  var toks = rawToks.filter(function (t, i) {
    if (ownModel && skip[i]) return false;
    // Односимвольные слова выбрасываем, но не цифры: «Pro 2» без двойки
    // превращается в «Pro» и склеивается с «Pro 3».
    return (t.length > 1 || /\d/.test(t)) && !TC.NOISE.has(t) && !TC.COLORS.has(t);
  });

  // Порядок слов оставляем как в названии: там бренд идёт раньше модели,
  // и поисковики площадок это учитывают.
  var strong = [], nums = [], picked = [], seen = {}, prevLatin = false;
  toks.forEach(function (t) {
    var latin = isLatin(t);
    var num = isNumber(t);

    // Одинокая цифра значит что-то только рядом с латиницей: «Pro 2», «Mi 5».
    // Сама по себе это «2 шт» или «3 в 1» — шум.
    if (num && t.length === 1 && !prevLatin) return;
    prevLatin = latin;

    if (seen[t]) return;
    if (isUnitToken(t)) return;                       // сверяется через specs
    if (!isStrongModel(t) && !latin && !num) return;
    seen[t] = 1;
    if (isStrongModel(t)) strong.push(t);
    else if (num) nums.push(t);
    if (picked.length < 6) picked.push(t);
  });

  // Латиницы и цифр нет вовсе — товар описан по-русски, берём русские слова.
  if (picked.length < 2) {
    picked = [];
    seen = {};
    toks.forEach(function (t) {
      if (seen[t] || picked.length >= 4) return;
      seen[t] = 1;
      picked.push(t);
    });
  }

  var text = picked.join(' ').slice(0, 60).trim();
  if (!text) text = TC.tokenize(raw).slice(0, 4).join(' ');

  // must — то, что обязано найтись в чужом названии: код модели и числа.
  // Всё остальное (бренд, слова описания) — лишь подтверждение.
  var must = strong.slice(0, 2).concat(nums.slice(0, 3));

  return {
    text: text,
    all: picked,
    model: strong.slice(0, 2),
    must: must,
    specs: TC.parseSpecs(title),
    brand: brand ? TC.flatten(brand) : '',
    source: String(title || '')
  };
};

// Модель может быть написана слитно или с разделителями: WH1000XM5 / WH 1000 XM5.
// Склеиваем только соседние целые токены и требуем точное равенство. Поиск по
// полностью склеенной строке ошибочно считал S10 частью S100.
var has = function (tokens, set, token) {
  if (set.has(token)) return true;
  if (token.length <= 2) return false;

  for (var i = 0; i < tokens.length; i++) {
    var joined = '';
    for (var j = i; j < tokens.length && joined.length < token.length; j++) {
      joined += tokens[j];
      if (joined === token) return true;
    }
  }
  return false;
};

// Похоже ли содержимое поля «бренд» на бренд. На WB туда попадает что угодно:
// «Power bank», «отличный», «-», «A.Pods Pro 2». Верим только одному слову
// без цифр — всё остальное сравнивать бессмысленно.
var looksLikeBrand = function (s) {
  var v = String(s || '').trim();
  return v.length > 2 && v.length <= 24 && !/\d/.test(v) && !/\s/.test(v);
};

/**
 * Похоже ли название вообще.
 *  - есть токен модели -> он обязан совпасть, плюс хотя бы одно слово (обычно бренд);
 *  - модели нет        -> требуем почти полного совпадения слов, иначе к 530-м
 *                         кроссовкам подберутся 574-е.
 */
TC.nameMatches = function (q, candidateTitle) {
  var tokens = TC.tokenize(candidateTitle);
  var set = new Set(tokens);
  var must = q.must || q.model || [];

  // Код модели и числа обязаны найтись. Без этого «AirPods Pro 2» спокойно
  // находит «AirPods Pro 3»: совпадают три слова из четырёх, порога хватает.
  for (var i = 0; i < must.length; i++) {
    if (!has(tokens, set, must[i])) return false;
  }

  var words = q.all.filter(function (t) { return must.indexOf(t) < 0; });
  if (!words.length) return must.length > 0;

  var hit = words.filter(function (w) { return has(tokens, set, w); }).length;

  // Длинный буквенно-цифровой код («520bt», «wh1000xm5») уникален сам по себе —
  // хватает одного подтверждающего слова. Голая цифра («Pro 2») не уникальна:
  // подделки как раз и мутируют бренд, оставляя цифру на месте («AiPods Pro 2»),
  // поэтому там требуем половину остальных слов.
  var strongCode = q.model.some(function (t) { return t.length >= 4; });
  var need = strongCode ? 1 : Math.max(1, Math.ceil(words.length * (must.length ? 0.5 : 0.7)));
  return hit >= need;
};

/**
 * Оценка одного найденного предложения.
 *
 *   good   — это наш товар, цену можно показывать как есть
 *   weak   — похоже на наш, но есть за что зацепиться: показываем цену,
 *            но без разницы в рублях и с честной подписью
 *   reject — точно не наш товар, не показываем вовсе
 *
 * refs = { typical, anchor } — сколько этот товар стоит на чужой площадке
 * (медиана по похожим карточкам) и сколько он стоит у нас на странице.
 */
TC.judge = function (q, cand, refs) {
  var title = String(cand.title || '');
  refs = refs || {};

  // Аксессуар вместо товара — самая частая и самая обидная ошибка.
  if (TC.isAccessory(title) && !TC.isAccessory(q.source)) {
    return { verdict: 'reject', reason: 'аксессуар' };
  }

  if (!TC.nameMatches(q, title)) return { verdict: 'reject', reason: 'другое название' };

  // Продавец сам написал, что это копия.
  if (TC.FAKE.test(title) && !TC.FAKE.test(q.source)) {
    return { verdict: 'reject', reason: 'реплика' };
  }

  var doubts = [];

  // Другая ёмкость, память или объём — это просто другой товар,
  // и он честно дешевле. Показывать его как «дешевле» нельзя.
  var conflict = TC.specConflict(q.specs, TC.parseSpecs(title));
  if (conflict) {
    if (conflict.hard) return { verdict: 'reject', reason: 'другая ' + conflict.label };
    doubts.push('другая ' + conflict.label);
  }

  if (TC.USED.test(title) && !TC.USED.test(q.source)) doubts.push('б/у или уценка');

  // Бренд — только подсказка, не доказательство. Поле заполняет продавец,
  // и оно врёт в обе стороны: у подделки за 1710 ₽ там честно стоит "Apple",
  // а у настоящего товара может стоять "отличный" или "Power bank".
  // Поэтому смотрим на него, только когда оно похоже на бренд: одно слово,
  // без цифр (иначе это «A.Pods Pro 2» — продавец зарегистрировал бренд
  // с именем чужого товара).
  if (q.brand && looksLikeBrand(cand.brand)) {
    var b = TC.flatten(cand.brand);
    if (b !== q.brand && q.brand.indexOf(b) < 0 && b.indexOf(q.brand) < 0) {
      doubts.push('другой бренд');
    }
  }

  // Цена. Тут и живёт всё враньё: подделки, б/у и не та комплектация всегда
  // в дешёвом хвосте, поэтому «самое выгодное предложение» — обычно они.
  // Своя цена — главный ориентир, он всегда честный. Медиана приходит
  // только если она вменяемая (см. typicalPrice в background.js): по хайповым
  // товарам подделок в выдаче больше, чем настоящих, и медиана уезжает к ним.
  var t = refs.typical, a = refs.anchor;
  if (a) {
    if (cand.price < a * TC.ANCHOR_FLOOR) return { verdict: 'reject', reason: 'слишком дёшево' };
    if (cand.price > a * TC.PRICE_CEIL) return { verdict: 'reject', reason: 'слишком дорого' };
    if (cand.price < a * TC.ANCHOR_DOUBT) doubts.push('подозрительно дёшево');
  }
  if (t) {
    // Отбрасывать по медиане можно, только когда она подтверждена своей ценой
    // (см. trustTypical в pick.js). Иначе она годится лишь на оговорку.
    if (refs.trustTypical) {
      if (cand.price < t * TC.PRICE_FLOOR) return { verdict: 'reject', reason: 'слишком дёшево' };
      if (!a && cand.price > t * TC.PRICE_CEIL) return { verdict: 'reject', reason: 'слишком дорого' };
    }
    if (cand.price < t * TC.PRICE_DOUBT && doubts.indexOf('подозрительно дёшево') < 0) {
      doubts.push('подозрительно дёшево');
    }
  }

  // Свежая карточка без единого отзыва и дешевле обычного — почти всегда
  // перекуп. По отдельности ни то, ни другое ничего не значит.
  // Исключение: Ozon пометил бренд проверенным или продаёт сам — тогда
  // отсутствие отзывов означает просто новую карточку, а не мутного продавца.
  var trusted = cand.verified || cand.seller === 'Ozon';
  if (t && !doubts.length && !trusted && cand.reviews === 0 && cand.price < t * 0.8) {
    doubts.push('нет отзывов');
  }

  if (doubts.length) return { verdict: 'weak', reason: doubts[0] };
  return { verdict: 'good', reason: '' };
};
