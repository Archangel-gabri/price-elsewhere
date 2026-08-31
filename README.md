# Price Elsewhere

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4c8bf5)](manifest.json)
[![No dependencies](https://img.shields.io/badge/dependencies-none-2ea44f)](#files)
[![No backend](https://img.shields.io/badge/backend-none-2ea44f)](#privacy)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**[Русская версия →](README.ru.md)**

A Chrome extension for the three Russian marketplaces. Open a product on one of them and it
checks the other two, then shows a panel in the corner of the card:

```
Ozon              2 397 ₽   you are here
Wildberries       1 995 ₽      −402 ₽
Яндекс Маркет     2 906 ₽      +509 ₽
```

The lowest price is highlighted. Clicking a row opens that product on that marketplace.

No build step. No dependencies. No backend. No account. Two checkboxes of stored state.

> Installed, it appears in the browser as **«Где дешевле»** — the project name here is the English one.

---

## The actual problem

Matching a product across marketplaces is the whole difficulty, and it has no clean solution.

There is **no shared identifier**. Wildberries has its `nmId`, Ozon has its SKU, Yandex Market
has its own, and none of them map to each other. Barcodes and manufacturer part numbers are not
exposed: on WB a card carries only the *seller's* article, which differs per seller, and on Ozon
the barcode is visible in the seller dashboard alone. No public "this product = that product"
database exists.

So the only possible move is matching by title — and titles are keyword soup:

> «Наушники беспроводные JBL Tune 520BT накладные Bluetooth с микрофоном чёрные»

Searching the whole string finds nothing. The extension extracts brand, model and numbers —
`jbl tune 520bt` — and searches on that. **Numbers must match.** That sounds like a detail, but
the whole thing rests on it: drop the `2` from "AirPods Pro 2" and the query happily returns
AirPods Pro 3 and reports someone else's price.

## Why it does not take the cheapest offer

This is the central decision in the extension.

Counterfeits, used goods, damaged stock and "not that bundle" all live in the cheap tail of the
results — that is what the cheap tail *is*. So "the best deal available" is systematically those,
and the better the extension gets at finding a bargain, the more often it lies.

A live example. WB results for `airpods pro 2`: normal price 10 282 ₽, cheapest item 828 ₽,
titled "AirPods Pro 2 USB-C Оригинал", brand field set to Apple. The brand field is filled in by
the seller and nobody verifies it. Right next to it sits "AiPods Pro 2", one letter swapped on purpose.

So instead of the minimum, it computes the **usual** price: a median over comparable cards with
the bottom 20% and top 10% discarded. And even that is not trusted unconditionally — on hyped
products the fakes outnumber the genuine ones and drag the median down with them. If the median
diverges from the open page's price by a multiple, it is thrown away and only the page's own
price is used, because that one is always honest.

Filtered out of the other marketplace's results:

- **different products** — model and numbers must match;
- **accessories** — cases, ear tips, cables, screen films. On WB also by the product category the
  API returns alongside the price: a case and a pair of headphones sit in different categories,
  which beats guessing from words;
- **replicas** — by the phrasings sellers use to keep the listing alive: `1:1`, "люкс качество", "по мотивам";
- **different configuration** — 10000 mAh instead of 20000, 128 GB instead of 256, one unit
  instead of a three-pack. This is reason number one why "the same" product is suddenly half the price;
- anything under a third of the open product's price.

## Three states, not two

A row is not just "found / not found":

| State | What is shown |
|---|---|
| **Confident** | Price and the difference in roubles |
| **Unsure** | Dimmed price, **no** rouble difference, and the reason next to it: «похожий товар · другая ёмкость» |
| **No match** | «точного совпадения нет» and a link to the search |

A difference in roubles is a promise that says *this is what you save*. Making that promise when
what turned up is a replica or a different capacity is not acceptable. Better to write "similar
product" than to draw "−6 662 ₽" and be wrong.

Green marks the lowest price **among confident rows only**. Otherwise green would light up on
exactly the counterfeit.

## Where the prices come from

The same endpoints the marketplaces use to render their own search pages:

| Marketplace | Source | Also returns |
|---|---|---|
| Wildberries | `search.wb.ru` | brand, category, seller, rating, review count |
| Ozon | `composer-api.bx` | rating, reviews, "verified brand" mark |
| Яндекс Маркет | `schema.org` markup on the search page | offer URLs, absolute |

No keys, no accounts. The price shown is the shelf price — the one a buyer sees, already
including the marketplace's card discount.

One detail that decides the architecture: **Ozon and Yandex Market do not answer a plain script,
only a browser.** The extension runs inside your browser, so it has that data; a server-side
scraper would not.

## Tests

19 offline checks cover spec parsing, query building, accessory rejection, service-worker cache
identity and, above all, picking the *usual* price rather than the lowest one. No dependencies:
the checks need neither a browser nor a DOM and never contact a marketplace.

```bash
npm test
```

Each check holds a failure that already happened or would have been expensive:

- **`\b` against Cyrillic.** In JavaScript a word boundary is Latin-only, so `/мАч\b/` never
  fires — the entire spec-matching layer dies silently on Russian titles and products start
  "matching" wrongly.
- **The bait in the cheap tail.** On live WB results for `airpods pro 2` the usual price is
  10 282 ₽ while the cheapest item is 828 ₽, brand field set to Apple by the seller. The test
  demands the computed price stay near ten thousand rather than drift to the counterfeit.
- **Anchor off by a multiple** — the median is discarded and only the open page's price is used.
- **Model-code boundaries.** `S10` must not match `S100`, while a split `WH 1000 XM5` must still
  match `WH1000XM5`.
- **Cache identity.** Two capacities that intentionally share the same search query must not share
  the service worker's ten-minute result cache.

## Privacy

- Nothing is sent anywhere. No account, no backend, no analytics.
- Nothing is stored except two toggles in browser storage.
- Network access is limited to three hosts, declared in the manifest.

No price history — there is no honest way to obtain it without a backend, so it is not offered.

## Install

```
chrome://extensions → Developer mode → Load unpacked → this folder
```

Works in Chrome, Yandex Browser, Edge and other Chromium browsers.

## Files

| File | Role |
|---|---|
| `manifest.json` | extension descriptor |
| `src/config.js` | constants: marketplaces, WB price region, price thresholds |
| `src/query.js` | title → query, spec parsing, match scoring |
| `src/pick.js` | offer selection: usual price instead of the minimum |
| `src/sources.js` | the three price sources (live in the service worker) |
| `src/background.js` | polls the marketplaces, caches answers for 10 minutes |
| `src/detect.js` | identifies product, price and brand on the current page |
| `src/panel.js` | panel rendering, the three row states |
| `src/panel.css` | its styles, light and dark theme |
| `src/content.js` | entry point, follows in-site navigation |
| `popup/` | popup with the on/off switch |

Only the service worker may talk to other domains. The content script asks "compare this" and
receives a finished answer.

**The boundary is drawn in the manifest, and it is not a formality.** The content script loads
`config · query · detect · logos · panel · content` — everything that touches the page. The service
worker pulls `config · query · pick · sources` through `importScripts` — everything that reaches the
network and decides which offer to trust. `query.js` deliberately lands on both sides: title parsing
is needed where the product is identified and where other marketplaces' cards are matched.

The practical consequence: **pure functions are separated from everything else.** `query` and `pick`
know nothing about the DOM or the network — only strings and numbers. That is why plain Node tests
them without a browser, while all the uncertainty (cookies, a 429 from a marketplace, a sleeping
worker) stays in `sources` and `background`, where it has to be handled.

## A rake already stepped on

In JavaScript, the word boundary `\b` and the class `\w` are **Latin-only** — Cyrillic letters do
not count as letters to them. Because of that `/мАч\b/` never fires, and the entire spec-matching
layer dies silently on Russian titles. In `query.js` every `\b` is replaced with explicit
lookarounds: `(?<![а-яё])` and `(?![a-zа-яё0-9])`.

## License

MIT — see [LICENSE](LICENSE).
