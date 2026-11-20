// Run with: node test.js
const assert = require('assert');
const { cleanUrl, bundleTarget, parseSold, isOffTopic } = require('./aliexpress-toolkit.user.js');

// Product URLs keep only the variant, pulled from pdp_npi when needed.
assert.strictEqual(
  cleanUrl('https://www.aliexpress.com/item/1005009501067571.html?aem_p4p_detail=2026&algo_pvid=b2&pdp_npi=6%40dis!CAD!6.15!1.60!!!27.96!7.26!%402101c68a17952018544025793e0e87!12000049326357410!sea!CA!&curPageLogUid=yo'),
  'https://www.aliexpress.com/item/1005009501067571.html?sku_id=12000049326357410');
assert.strictEqual(cleanUrl('https://www.aliexpress.com/item/1.html?spm=a&sku_id=99#nav-review'), 'https://www.aliexpress.com/item/1.html?sku_id=99#nav-review');
assert.strictEqual(cleanUrl('https://www.aliexpress.com/item/1.html?spm=a'), 'https://www.aliexpress.com/item/1.html');
// Search URLs keep real filters.
assert.strictEqual(cleanUrl('https://www.aliexpress.com/w/wholesale-usb.html?spm=a2g0o&page=2&sortType=total_tranpro_desc&algo_pvid=x'), 'https://www.aliexpress.com/w/wholesale-usb.html?page=2&sortType=total_tranpro_desc');

assert.strictEqual(bundleTarget('https://www.aliexpress.com/ssr/300000512/BundleDeals2?productIds=1005010439240901:12000060141433739&pha_manifest=ssr'), '/item/1005010439240901.html?sku_id=12000060141433739');
assert.strictEqual(bundleTarget('/ssr/300000512/BundleDeals2?productIds=1005010439240901'), '/item/1005010439240901.html');
assert.strictEqual(bundleTarget('https://www.aliexpress.com/ssr/300001493/welcomegiftspmpc?productIds=1'), null);
assert.strictEqual(bundleTarget('//www.aliexpress.com/item/1.html'), null);

assert.strictEqual(parseSold('USB cable|10,000+ sold|4.8'), 10000);
assert.strictEqual(parseSold('100K+ sold'), 100000);
assert.strictEqual(parseSold('1.5K sold'), 1500);
assert.strictEqual(parseSold('754 sold'), 754);
assert.strictEqual(parseSold('no sales yet'), 0);

assert.strictEqual(isOffTopic('UGREEN USB Type C To USB C Cable', 'usb c cables'), false);
assert.strictEqual(isOffTopic('Phone case for iPhone', 'usb c cable'), true);
assert.strictEqual(isOffTopic('Anything', 'ab'), false); // nothing to match against

console.log('all tests passed');
