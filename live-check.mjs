// Live check: runs the userscript on real AliExpress pages in a hidden Chrome and reports what works.
// Run with: node live-check.mjs   (needs Node 22+ and Chrome, Brave or Edge; set CHROME=/path/to/browser to choose)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browser = BROWSERS.find((p) => p && existsSync(p));
if (!browser) { console.error('No Chrome-type browser found. Set CHROME=/path/to/browser'); process.exit(1); }

// Stand-ins for Tampermonkey's functions, safe to run before the page exists.
const SHIM = `
window.GM_getValue = (k, d) => d;
window.GM_setValue = () => {};
window.GM_registerMenuCommand = () => 1;
window.GM_unregisterMenuCommand = () => {};
window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css;
  const add = () => (document.head || document.documentElement).appendChild(s);
  document.documentElement ? add() : new MutationObserver((m, o) => { if (document.documentElement) { o.disconnect(); add(); } }).observe(document, { childList: true }); };
window.GM_xmlhttpRequest = (o) => fetch(o.url).then((r) => r.text()).then((t) => o.onload({ responseText: t })).catch(o.onerror);
`;
const userscript = SHIM + readFileSync(new URL('./aliexpress-toolkit.user.js', import.meta.url), 'utf8');
const { parseSold } = createRequire(import.meta.url)('./aliexpress-toolkit.user.js'); // the script's own rule, not a copy

const CHECKS = [
  ['Search: results load, hide non-products, sort by sold, clean URL', 'https://www.aliexpress.com/w/wholesale-usb-c-cable.html?spm=a2g0o.test', `
    const cl = document.querySelector('#card-list');
    const sold = ${parseSold};
    const shown = [...cl.children].filter((c) => !c.hasAttribute('data-aetk-hide') && c.querySelector('a[href]')).sort((a, b) => a.style.order - b.style.order).map((c) => sold(c.textContent));
    return { 'cards shown': shown.length > 10, 'sorted most-sold first': shown.every((s, i) => i === 0 || shown[i - 1] >= s),
      'all results loaded': !cl.querySelector('[data-aetk-wait]'), 'no bundle links left': !cl.querySelector('a[href*="BundleDeals"]'), 'URL cleaned': !location.search.includes('spm') };`],
  ['Product: variant picture, split layout, reviews button, text-first description', 'https://www.aliexpress.com/item/1005006505041416.html', `
    document.querySelector('#nav-description').scrollIntoView(); await sleep(6000);
    const box = (s) => document.querySelector(s).getBoundingClientRect();
    const host = [...document.querySelectorAll('#product-description *')].find((e) => e.shadowRoot);
    const all = host ? [...host.shadowRoot.querySelectorAll('h1,h2,h3,p,li,img')] : [];
    const firstImg = all.findIndex((e) => e.tagName === 'IMG');
    const textAfterImg = all.slice(firstImg).some((e) => e.tagName !== 'IMG' && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const main = document.querySelector('[class*="magnifier--image"]');
    const picId = (src) => src.split('/').pop().split('_')[0]; // picture file name without its size suffix
    return { 'main picture = selected variant, and it loads': picId(main.src) === picId(document.querySelector('[class*="sku-item--selected"] img').src) && main.naturalWidth > 0,
      'reviews beside description': box('#nav-review').left > box('#nav-description').right - 5, 'reviews-tab button': !!document.querySelector('#nav-review .aetk-btn'),
      'description text before pictures': firstImg > 0 && !textAfterImg, 'help button hidden': getComputedStyle(document.querySelector('[class*="survey--wrap"]')).display === 'none' };`],
  ['Reviews tab: loads and keeps loading', 'https://www.aliexpress.com/item/1005006505041416.html#aetk-reviews', `
    const first = document.querySelectorAll('.review').length; window.scrollTo(0, document.body.scrollHeight); await sleep(4000);
    return { 'first reviews shown': first >= 20, 'more load on scroll': document.querySelectorAll('.review').length > first, 'photos shown': document.querySelectorAll('.imgs img').length > 0 };`],
  ['Bundle deal page redirects', 'https://www.aliexpress.com/ssr/300000512/BundleDeals2?productIds=1005010439240901:12000060141433739', `
    return { 'landed on product page': location.pathname === '/item/1005010439240901.html' };`],
  ['Home: pop-ups hidden', 'https://www.aliexpress.com/', `
    return { 'no visible pop-up': [...document.querySelectorAll('[class*="poplayer-modal"], body > div[style*="z-index: 1000000"]')].every((e) => e.offsetWidth === 0),
      'no notification prompt': ![...document.querySelectorAll('body *')].some((e) => e.children.length < 5 && e.offsetWidth > 0 && /Subscribe to notifications/.test(e.textContent)) };`],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let skipped = 0;
for (const [name, url, body] of CHECKS) {
  const profile = mkdtempSync(join(tmpdir(), 'aetk-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,1800', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0; const waiting = {};
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (waiting[d.id]) waiting[d.id](d); };
    const send = (method, params = {}) => new Promise((r) => { waiting[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: userscript });
    await send('Page.navigate', { url });
    await sleep(10000);
    const res = await send('Runtime.evaluate', { expression: `(async () => {
      if ([...document.querySelectorAll('.J_MIDDLEWARE_FRAME_WIDGET iframe')].some((f) => f.offsetWidth > 0)) return { robotCheck: true };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`, awaitPromise: true, returnByValue: true });
    const results = res.result.result.value;
    console.log(`\n${name}`);
    if (results && results.robotCheck) { skipped++; console.log('  – skipped: AliExpress asked for a robot check. Wait an hour (or solve it once in your browser) and retry.'); }
    else if (!results) { failed++; console.log('  ✗ check crashed:', res.result.exceptionDetails?.exception?.description || 'no result'); }
    else for (const [what, ok] of Object.entries(results)) { if (!ok) failed++; console.log(`  ${ok ? '✓' : '✗'} ${what}`); }
    ws.close();
  } finally { proc.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
}
console.log(failed ? `\n${failed} check(s) failed` : skipped ? `\nNo failures, but ${skipped} page(s) skipped` : '\nAll checks passed');
process.exit(failed || skipped ? 1 : 0);
