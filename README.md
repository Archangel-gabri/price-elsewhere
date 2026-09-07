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
Wildberries       1 995 ₽
Яндекс Маркет     2 906 ₽
```

Illustrative prices. Clicking a result opens its marketplace page. The panel does not rank
prices or calculate savings, even when the product match passes its checks: payment conditions,
delivery and customs charges may differ. A visible note asks you to check the final cost on the marketplace.

No build step. No dependencies. No backend. No account. Two checkboxes of stored state.

> Installed, it appears in the browser as **«Где дешевле»** — the project name here is the English one.

---

## The actual problem

Matching a product across marketplaces is the central difficulty in this implementation.

The sources used here expose platform-specific identifiers: Wildberries has its `nmId`, Ozon
has its SKU and Yandex Market has its own identifiers. This implementation has no verified map
between them and does not assume that every response contains a barcode or manufacturer part number.

It therefore matches titles and available product fields. Titles often contain search keywords:

> «Наушники беспроводные JBL Tune 520BT накладные Bluetooth с микрофоном чёрные»

The extension extracts brand, model and numbers — `jbl tune 520bt` — to form a shorter query.
Recognized model identifiers and required specifications must agree, allowing supported unit
equivalences. Dropping the `2` from "AirPods Pro 2" can otherwise admit another generation.
Title matching remains a heuristic, not proof that the offers are identical.

## How an offer is selected

The raw minimum can belong to an accessory, used item, replica or different configuration.
A low price alone does not establish any of those conditions, and a high price does not prove authenticity.

An older WB example, retained in the regression corpus, included an 828 ₽ offer alongside
prices around 10 282 ₽. Its title and Apple brand field were not enough to verify the product;
these are historical fixture values, not today's marketplace prices.

The selector uses a trimmed median as one reference, discarding the bottom 20% and top 10%.
If it differs too far from the open page's price, that reference is discarded. The page price
is still only an extracted amount: it may depend on a bank, wallet or additional charges.

After filtering, the selector takes the lowest displayed price among sufficiently similar
remaining candidates, preferring those without a recorded doubt. The median is a filtering
heuristic, not the price shown for the selected offer. Neither step verifies the lowest final purchase cost.

Filtered out of the other marketplace's results:

- **different products** — model and numbers must match;
- **accessories** — cases, ear tips, cables, screen films. On WB also by the product category the
  API returns alongside the price: a case and a pair of headphones sit in different categories,
  which beats guessing from words;
- **replica indicators** — phrases such as `1:1`, "люкс качество", "по мотивам";
- **different configuration** — 10000 mAh instead of 20000, 128 GB instead of 256, one unit
  instead of a three-pack, where the relevant specification is recognized;
- prices below 35% of the open page's amount when that anchor is available — a heuristic that can also reject a genuine offer.

## Product confidence and source availability

A row is not just "found / not found":

| State | What is shown |
|---|---|
| **Match passes the checks** | Displayed price and a link; no savings calculation or best-price highlight |
| **Unsure** | Dimmed price and a separate reason: «похожий товар · другой бренд» |
| **No match** | «точного совпадения нет» and a link to the search |
| **Source unavailable** | «не удалось узнать цену» and a link to the search |

Product confidence and price comparability are separate. None of the current sources confirms
equivalent payment conditions and all mandatory charges, so no row gets a savings difference,
an equality claim or a green best-price highlight. The price warning remains visible during
loading and after successful, uncertain or failed responses; missing prices appear as `—`.

## Where the prices come from

The adapters read these search sources:

| Marketplace | Source | Also returns |
|---|---|---|
| Wildberries | `search.wb.ru` | brand, category, seller, rating, review count |
| Ozon | `composer-api.bx` | rating, reviews, "verified brand" mark |
| Яндекс Маркет | `schema.org` markup on the search page | offer URLs, absolute |

No marketplace API keys or extension account are required. The current row uses an amount
extracted from the open product page; other rows use search results. Bank, Wallet and personal
discounts, delivery and customs charges may differ or be absent from these amounts. Check the
final price and payment terms on the marketplace before buying. Price-based filtering still
uses these extracted amounts; it does not establish economic comparability.

Requests run inside your browser and can use its marketplace session when the browser permits
it. This does not guarantee access: a marketplace can return HTTP 403, require a CAPTCHA or
otherwise reject a request. Price comparison depends on its search endpoints remaining available.

## Tests

`npm run check` passed 110 offline checks on 2026-09-07: 87 core, 8 background,
2 content lifecycle, 1 privacy-copy and 12 panel-pricing checks. They use Node without installed
dependencies or marketplace requests. The renderer tests execute the real `panel.js` against a
small DOM tree; they do not measure browser layout.

```bash
npm run check
```

Each check holds a failure that already happened or would have been expensive:

- **`\b` against Cyrillic.** In JavaScript a word boundary is Latin-only, so `/мАч\b/` never
  fires — the entire spec-matching layer dies silently on Russian titles and products start
  "matching" wrongly.
- **A low-price outlier.** The saved 828 ₽ fixture must not drag the trimmed reference below
  9 000 ₽. This tests the estimator, not authenticity or today's prices.
- **Anchor off by a multiple** — the median reference is discarded; the remaining page-price
  heuristic still does not verify payment conditions.
- **Model-code boundaries.** `S10` must not match `S100`, while a split `WH 1000 XM5` must still
  match `WH1000XM5`.
- **Cache identity.** Two capacities that intentionally share the same search query must not share
  the service worker's ten-minute result cache.
- **Two memory values.** `8 GB 256 GB` must match its joined spelling, while a changed RAM,
  storage value or model must not pass. Reordered repeated units are conservatively rejected.
- **Unverified price basis.** The real renderer preserves numbers and product warnings but shows
  no savings, equality or best-price highlight; repeated updates clear obsolete labels and links.

A bounded Brave check on 2026-09-07 also verified panels on selected Ozon and Yandex Market
product pages after the fix: prices remained visible, comparison highlights/deltas were absent,
and the full warning fitted. This does not validate all products, browsers or checkout totals.

## Privacy

- There is no backend of our own and no analytics.
- To compare prices, the search query is sent directly to the marketplace endpoints:
  `www.ozon.ru`, `search.wb.ru` and `market.yandex.ru`.
- Requests are made by the browser and use the current marketplace session cookies when the browser permits them.
- Nothing is persistently stored except two toggles in browser storage.
  Search answers are cached in volatile service-worker memory and reused for no more than ten minutes.
- Network access is limited to the three hosts declared in the manifest.

Price history is not implemented.

## Install

```
chrome://extensions → Developer mode → Load unpacked → this folder
```

Designed for Chromium browsers supporting Manifest V3. The dated live check above used Brave;
compatibility with every Chromium distribution has not been verified.

## Files

| File | Role |
|---|---|
| `manifest.json` | extension descriptor |
| `src/config.js` | constants: marketplaces, WB price region, price thresholds |
| `src/query.js` | title → query, spec parsing, match scoring |
| `src/pick.js` | offer selection after title/specification and price heuristics |
| `src/sources.js` | the three price sources (live in the service worker) |
| `src/background.js` | polls the marketplaces, caches answers for 10 minutes |
| `src/detect.js` | identifies product, price and brand on the current page |
| `src/panel.js` | prices, product-match states and a visible price-conditions warning |
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
