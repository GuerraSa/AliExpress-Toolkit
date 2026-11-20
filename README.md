# AliExpress Toolkit

A [Tampermonkey](https://www.tampermonkey.net/) userscript that makes shopping on AliExpress less noisy: only real products in search, sorted by how many were sold, clean links, text-first product descriptions, and reviews you can actually read.

## Install

1. Install the Tampermonkey extension for your browser (Chrome, Edge, Firefox, Safari).
2. Click **[Install AliExpress Toolkit](https://github.com/GuerraSa/AliExpress-Toolkit/releases/latest/download/aliexpress-toolkit.user.js)**. Tampermonkey opens an install page; click **Install**.
3. Open or refresh any `aliexpress.com` page.

Tampermonkey checks this link for updates automatically, so new releases install themselves.

## Features

### Search results
- **Real products only.** Cards that aren't a normal product are hidden: "Max Combo", SuperDeals, free-gift offers and similar promo cards.
- **Bundle deals become normal products.** "Bundle deals" cards link straight to the product page instead of the bundle page.
- **Sorted by sold count.** The most-sold items come first. Only the order on screen changes; the page never reloads.
- **Off-topic filter (optional, off by default).** Hides results whose title doesn't contain every word you searched for. Turn it on or off from the Tampermonkey menu: click the Tampermonkey icon, then **Off-topic filter: ON/OFF**.

### Product pages
- **Bundle deal pages redirect** to the single product page, keeping the variant you picked.
- **Correct main picture.** The big image shows the variant that is selected (the one the price is for), not the generic cover photo.
- **Text-first description.** The full description opens automatically, with its text on top and the pictures below.
- **Description and reviews side by side.** Specifications and description on the left; reviews on the right, in their own scrolling column.
- **Reviews in a new tab.** The **Open all reviews in a new tab ↗** button opens a simple page with every review, more loading as you scroll, and every photo shown full size. Click a photo to open the original.
- **Help/feedback button hidden.**

### Everywhere
- **Clean URLs.** Tracking parameters are removed from the address bar once the page has loaded, so copied links are short. Product links keep only `sku_id` (the selected variant). Search links keep your filters and page number.

## Notes and limits

- AliExpress changes its pages often. If a feature stops working, please [open an issue](https://github.com/GuerraSa/AliExpress-Toolkit/issues) and say which page it was on.
- Written for the English `aliexpress.com` site. Sold counts in other languages aren't recognized, so those results won't be sorted.
- The reviews tab loads reviews straight from AliExpress's own review service, translated into your site language and shipping country.

## Development

The whole script is one file: [`aliexpress-toolkit.user.js`](aliexpress-toolkit.user.js). Its small helper functions have a self-test:

```sh
node test.js
```

To release a new version, bump `@version` in the script header, commit, then push a matching tag:

```sh
git tag v1.0.1 && git push origin v1.0.1
```

GitHub Actions checks the tag matches `@version`, runs the self-test, and publishes the release with the script attached.
