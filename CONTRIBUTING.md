# Contributing to Price Elsewhere

Thank you for helping improve Price Elsewhere. Keep changes focused and preserve the distinction
between a product match, an extracted price, and a verified checkout total.

## Start with an Issue

Search the [issue tracker](https://github.com/Archangel-gabri/price-elsewhere/issues) first. Open
an issue for a bug or proposal so its marketplace, permission, and matching impact can be agreed.

## Local Setup

The extension has no runtime dependencies and no build step.

```bash
git clone https://github.com/Archangel-gabri/price-elsewhere.git
cd price-elsewhere
npm run check
```

For a manual check, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
and select the repository folder. Use only test browsing data and remove the temporary install
after the check.

## Tests and Linting

Run the complete offline gate:

```bash
npm run check
```

This runs `node --check` over runtime and test JavaScript, then all repository test runners. No
separate formatter or linter is configured. Offline tests do not prove current marketplace access
or price comparability.

## Code Style

- Use the existing vanilla JavaScript style and keep pure parsing and selection logic testable.
- Preserve Manifest V3 permissions, content-script order, and the service-worker network boundary.
- Never present an extracted amount as a verified final price or guaranteed saving.
- Add a sanitized regression fixture for matching, cache, source, or rendering bugs.
- Avoid unrelated formatting, generated archives, or dependency changes.

## Propose a Change

1. Agree the scope in an issue.
2. Create a branch such as `fix/product-matching` from `master`.
3. Make the smallest complete change and update tests and documentation.
4. Run `npm run check` and review the complete diff.
5. Open a pull request with the issue link, test output, and sanitized screenshots if useful.

## Data and Secrets

Do not submit marketplace cookies, sessions, account details, browsing history, API keys, tokens,
credentials, personal data, database dumps, or raw page captures containing customer information.

## Security Vulnerabilities

Do not open a public issue for a suspected vulnerability. Use GitHub Security's
[Report a vulnerability](https://github.com/Archangel-gabri/price-elsewhere/security/advisories/new)
form and include safe reproduction steps without secrets or personal data.
