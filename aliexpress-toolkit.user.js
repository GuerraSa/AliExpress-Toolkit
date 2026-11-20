// ==UserScript==
// @name         AliExpress Toolkit
// @namespace    https://github.com/GuerraSa/AliExpress-Toolkit
// @version      1.1.1
// @description  Cleaner AliExpress: real products only, sorted by sold count, clean URLs, bundle-page redirect, text-first descriptions, side-by-side reviews, and a full reviews tab with infinite scroll.
// @author       GuerraSa
// @match        *://*.aliexpress.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      feedback.aliexpress.com
// @homepageURL  https://github.com/GuerraSa/AliExpress-Toolkit
// @supportURL   https://github.com/GuerraSa/AliExpress-Toolkit/issues
// @downloadURL  https://github.com/GuerraSa/AliExpress-Toolkit/releases/latest/download/aliexpress-toolkit.user.js
// @updateURL    https://github.com/GuerraSa/AliExpress-Toolkit/releases/latest/download/aliexpress-toolkit.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Small pure helpers (no page access) — also exercised by test.js
  // ---------------------------------------------------------------------------

  // Tracking parameters stripped from non-product pages (search keeps its real filters).
  const TRACKING = /^(spm|scm.*|.*pvid|algo_.*|aem_.*|pdp_.*|utparam-url|search_p4p_id|curPageLogUid|gps-id|ws_ab_test|gatewayAdapt|_randl_.*|aff_.*|af|cn|cv|dp|sk|tt|afSmartRedirect|mall_affr|terminal_id|trafficChannel|sourceType|srcSns|spreadType|bizType|social_params|aecmd|isdl|tracelog|businessType|shareId|share_.*)$/i;

  // Product pages keep only the chosen variant (sku_id); everything else is tracking.
  function cleanUrl(href) {
    const u = new URL(href);
    if (/^\/item\/\d+\.html/.test(u.pathname)) {
      const npi = u.searchParams.get('pdp_npi') || '';
      const sku = u.searchParams.get('sku_id') || (npi.match(/!(\d{12,})!/) || [])[1];
      u.search = sku ? '?sku_id=' + sku : '';
    } else {
      [...u.searchParams.keys()].forEach((k) => TRACKING.test(k) && u.searchParams.delete(k));
    }
    return u.href;
  }

  // "Bundle deals" pages wrap a single real product: return its normal product page, or null.
  function bundleTarget(href) {
    const u = new URL(href, 'https://www.aliexpress.com');
    if (!/\/BundleDeals/i.test(u.pathname)) return null;
    const [id, sku] = (u.searchParams.get('productIds') || '').split(',')[0].split(':');
    return /^\d+$/.test(id) ? `/item/${id}.html` + (/^\d+$/.test(sku || '') ? '?sku_id=' + sku : '') : null;
  }

  // "10,000+ sold" -> 10000, "100K+ sold" -> 100000, no sold text -> 0.
  // shortcut: English number format only, extend if other site languages are used.
  function parseSold(text) {
    const m = text.match(/([\d.,]+)\s*([KkMm]?)\+?\s*sold/);
    if (!m) return 0;
    return parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1);
  }

  // A result is off-topic when its title is missing any search word (3+ letters, plural ignored).
  function isOffTopic(title, query) {
    const t = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    return query.toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .some((w) => !t.includes(w.replace(/s$/, '')));
  }

  if (typeof window === 'undefined') {
    module.exports = { cleanUrl, bundleTarget, parseSold, isOffTopic };
    return;
  }

  // ---------------------------------------------------------------------------
  // Runs before the page loads
  // ---------------------------------------------------------------------------

  const bundle = bundleTarget(location.href);
  if (bundle) return location.replace(bundle);

  const productId = (location.pathname.match(/^\/item\/(\d+)\.html/) || [])[1];
  if (productId && location.hash === '#aetk-reviews') return reviewsPage(productId);

  // The "Subscribe to notifications" prompt skips itself for 3 days after it was "shown".
  try { localStorage.setItem('webpush-auth-popup', JSON.stringify({ date: Date.now(), status: 'shown' })); } catch (e) { /* storage blocked: prompt may show */ }

  GM_addStyle(`
    /* hide the floating feedback/help button */
    [class*="survey--wrap"] { display: none !important; }
    /* offer, promotion and coupon pop-ups: AliExpress's pop-up system wraps every one in this layer */
    body > div[style*="z-index: 1000000"], [class*="poplayer-modal"] { display: none !important; }
    /* search results the script removed */
    [data-aetk-hide] { display: none !important; }
    /* not-yet-loaded results: flat and first, so AliExpress sees them on screen and loads them all now */
    [data-aetk-wait] { order: -1 !important; height: 0 !important; overflow: hidden; }

    /* product page: description + specs on the left, reviews on the right */
    .pdp-body-top-left { display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: row dense; column-gap: 24px; align-items: start; }
    .pdp-body-top-left > * { grid-column: 1 / -1; min-width: 0; }
    .pdp-body-top-left > #nav-specification, .pdp-body-top-left > #nav-description { grid-column: 1; }
    .pdp-body-top-left > #nav-review { grid-column: 2; grid-row: span 6; position: sticky; top: 90px; max-height: calc(100vh - 100px); overflow-y: auto; }

    .aetk-btn { display: inline-block; margin: 8px 0 12px; padding: 6px 14px; border-radius: 16px; background: #191919; color: #fff !important; font-size: 14px; text-decoration: none; }
  `);

  let menuId;
  function registerMenu() {
    if (menuId !== undefined) GM_unregisterMenuCommand(menuId);
    menuId = GM_registerMenuCommand(`Off-topic filter: ${GM_getValue('offTopic', false) ? 'ON' : 'OFF'}`, () => {
      GM_setValue('offTopic', !GM_getValue('offTopic', false));
      registerMenu();
      run();
    });
  }
  registerMenu();

  // ---------------------------------------------------------------------------
  // Runs again whenever the page changes (AliExpress builds pages piece by piece)
  // ---------------------------------------------------------------------------

  let pageSettled = false; // AliExpress reads the original URL while loading, so clean it only afterwards
  let userPickedImage = false;
  document.addEventListener('mouseover', (e) => {
    if (e.target.closest && e.target.closest('[class*="slider--wrap"], [class*="sku--wrap"]')) userPickedImage = true;
  });

  function run() {
    if (pageSettled) {
      const clean = cleanUrl(location.href);
      if (clean !== location.href) history.replaceState(history.state, '', clean);
    }
    tidySearchResults();
    if (productId) tidyProductPage();
  }

  function searchQuery() {
    const p = new URLSearchParams(location.search).get('SearchText');
    const m = location.pathname.match(/\/w\/wholesale-(.+)\.html/);
    return p || (m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : '');
  }

  function tidySearchResults() {
    const list = document.querySelector('#card-list');
    if (!list) return;
    const query = searchQuery();
    const offTopic = GM_getValue('offTopic', false);
    const cards = [...list.children].map((el) => {
      const link = el.querySelector('a[href]');
      if (!link) { el.setAttribute('data-aetk-wait', ''); return null; } // placeholder that hasn't loaded yet
      el.removeAttribute('data-aetk-wait');
      const href = link.getAttribute('href');
      const target = bundleTarget(href);
      if (target) link.setAttribute('href', target);
      const realProduct = target || /\/item\/\d+/.test(href); // Max Combo, SuperDeals, gifts, ads link elsewhere
      const title = (el.querySelector('h3') || el).textContent;
      const hide = !realProduct || (offTopic && query && isOffTopic(title, query));
      if (hide) el.setAttribute('data-aetk-hide', '');
      else el.removeAttribute('data-aetk-hide');
      return { el, sold: parseSold(el.textContent) };
    });
    // Reorder visually with CSS "order" — the page itself is never reloaded or rebuilt.
    cards.filter(Boolean).sort((a, b) => b.sold - a.sold).forEach((c, i) => { c.el.style.order = i; });
  }

  function tidyProductPage() {
    // Show the selected variant's picture instead of the generic cover photo.
    const main = document.querySelector('[class*="magnifier--image"]');
    const skuImg = document.querySelector('[class*="sku-item--selected"] img');
    if (main && skuImg && !userPickedImage) {
      const big = skuImg.src.replace(/_\d+x\d+/, '_960x960'); // same size AliExpress uses for the main picture
      if (main.src !== big) main.src = big;
    }

    // Button to open every review in its own tab.
    const reviews = document.querySelector('#nav-review');
    if (reviews && !reviews.querySelector('.aetk-btn')) {
      const a = document.createElement('a');
      a.className = 'aetk-btn';
      a.href = `/item/${productId}.html#aetk-reviews`;
      a.target = '_blank';
      a.textContent = 'Open all reviews in a new tab ↗';
      reviews.prepend(a);
    }

    // Expand the description once, then move its pictures below the text.
    const desc = document.querySelector('#nav-description');
    const more = desc && desc.querySelector('[class*="extend--btn"]');
    if (more && !desc.dataset.aetkExpanded) {
      desc.dataset.aetkExpanded = '1';
      more.click();
    }
    const host = document.querySelector('#product-description');
    const root = host && ([...host.querySelectorAll('*')].find((e) => e.shadowRoot) || {}).shadowRoot || host;
    const imgs = root ? [...root.querySelectorAll('img:not([data-aetk-moved])')] : [];
    if (imgs.length) {
      let box = root.querySelector('.aetk-desc-images');
      if (!box) {
        box = document.createElement('div');
        box.className = 'aetk-desc-images';
        (root.querySelector('.product-description') || root).append(box);
      }
      imgs.forEach((img) => {
        img.dataset.aetkMoved = '1';
        img.style.display = 'block';
        const link = img.closest('a'); // keep picture links clickable, unless the link wraps the whole description
        box.append(link && !link.contains(box) ? link : img);
      });
    }
  }

  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 250); })
    .observe(document, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(() => { pageSettled = true; run(); }, 3000));

  // ---------------------------------------------------------------------------
  // Full reviews tab: /item/<id>.html#aetk-reviews
  // ---------------------------------------------------------------------------

  function reviewsPage(id) {
    window.stop(); // don't load the normal product page
    const cookie = decodeURIComponent((document.cookie.match(/aep_usuc_f=([^;]+)/) || [])[1] || '');
    const country = (cookie.match(/region=([A-Z]{2})/) || [])[1] || 'US';
    const lang = (cookie.match(/b_locale=([a-z]{2}_[A-Z]{2})/) || [])[1] || 'en_US';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const imgUrl = (s) => (/^https:\/\/[\w.-]+\.(aliexpress-media|alicdn)\.com\//.test(s) ? esc(s) : '');

    (document.documentElement || document.appendChild(document.createElement('html'))).innerHTML = `<head><meta charset="utf-8"><title>Reviews · ${id}</title><style>
      body { font: 15px/1.5 -apple-system, "Segoe UI", sans-serif; max-width: 900px; margin: 0 auto; padding: 16px; color: #191919; background: #fff; }
      .review { border-bottom: 1px solid #e5e5e5; padding: 16px 0; }
      .meta { color: #757575; font-size: 13px; }
      .stars { color: #f5a623; }
      .imgs img { display: block; max-width: 100%; max-height: 80vh; margin: 8px 0; border-radius: 6px; }
      .extra { margin-top: 8px; padding-left: 12px; border-left: 3px solid #e5e5e5; }
      #status { text-align: center; color: #757575; padding: 24px; }
      a { color: #0a66c2; }
    </style></head><body>
      <p><a href="/item/${id}.html">← Back to product</a></p>
      <h1 id="summary">Reviews</h1>
      <div id="list"></div>
      <div id="status">Loading…</div>
    </body>`;

    const list = document.getElementById('list');
    const status = document.getElementById('status');
    status.onclick = () => loadNext(); // retry after an error
    let page = 0;
    let totalPages = 1;
    let loading = false;

    const imgsHtml = (urls) => (urls && urls.length ? `<div class="imgs">${urls.map((u) => imgUrl(u) && `<a href="${imgUrl(u)}" target="_blank"><img loading="lazy" src="${imgUrl(u)}"></a>`).join('')}</div>` : '');

    function render(r) {
      const stars = Math.round((r.buyerEval || 0) / 20);
      const div = document.createElement('div');
      div.className = 'review';
      div.innerHTML = `
        <div class="meta"><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span> · ${esc(r.buyerName)} (${esc(r.buyerCountry)}) · ${esc(r.evalDate)}</div>
        ${r.skuInfo ? `<div class="meta">${esc(r.skuInfo)}</div>` : ''}
        <div>${esc(r.buyerTranslationFeedback || r.buyerFeedback)}</div>
        ${imgsHtml(r.images)}
        ${r.buyerAddFbContent || (r.buyerAddFbImages || []).length ? `<div class="extra"><div class="meta">Additional feedback · ${esc(r.buyerAddFbDate)}</div><div>${esc(r.buyerAddFbTranslation || r.buyerAddFbContent)}</div>${imgsHtml(r.buyerAddFbImages)}</div>` : ''}`;
      list.append(div);
    }

    function loadNext() {
      if (loading || page >= totalPages) return;
      loading = true;
      page += 1;
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://feedback.aliexpress.com/pc/searchEvaluation.do?productId=${id}&lang=${lang}&country=${country}&page=${page}&pageSize=20&filter=all&sort=complex_default`,
        onload: (res) => {
          loading = false;
          let data;
          try { data = JSON.parse(res.responseText).data; } catch (e) { data = null; }
          if (!data) { status.textContent = 'Could not load reviews. Click here to retry.'; page -= 1; return; }
          totalPages = data.totalPage || 0;
          const s = data.productEvaluationStatistic || {};
          document.getElementById('summary').textContent = `Reviews · ${s.evarageStar || '–'} ★ · ${data.totalNum || 0} reviews`;
          (data.evaViewList || []).forEach(render);
          status.textContent = page >= totalPages ? 'No more reviews.' : 'Loading…';
          if (status.getBoundingClientRect().top < innerHeight) loadNext(); // fill the screen
        },
        onerror: () => { loading = false; page -= 1; status.textContent = 'Network error. Click here to retry.'; },
      });
    }

    new IntersectionObserver((entries) => entries[0].isIntersecting && loadNext(), { rootMargin: '1500px' }).observe(status);
    loadNext();
  }
})();
