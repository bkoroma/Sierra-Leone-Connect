import { chromium } from 'playwright'; import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const demoCfg = fs.readFileSync((ROOT + '/js/config.js'),'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const b = await chromium.launch();
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log(c ? '✓' : '✗', n); };
// 1) native shell simulation, demo data
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: demoCfg }));
await ctx.addInitScript(() => {
  const L = {}; window.__L = L; window.__calls = [];
  window.Capacitor = { isNativePlatform: () => true, Plugins: {
    App: { addListener: (e, f) => { L[e] = f; }, minimizeApp: () => window.__calls.push('minimize') },
    StatusBar: { setBackgroundColor: () => window.__calls.push('statusbar'), setStyle: () => {} },
    SplashScreen: { hide: () => window.__calls.push('splash') } } };
});
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8766/'); await p.waitForTimeout(800);
t('splash hidden + status bar styled', await p.evaluate(() => __calls.includes('splash') && __calls.includes('statusbar')));
t('no service worker in app', await p.evaluate(async () => !(await navigator.serviceWorker.getRegistrations()).length));
t('backButton listener registered', await p.evaluate(() => typeof __L.backButton === 'function'));
await p.click('#tab-signup'); await p.check('#form-signup [name=gender][value=man]', { force: true }); await p.fill('#form-signup [name=firstName]', 'Nn'); await p.fill('#form-signup [name=lastName]', 'Test'); await p.fill('#form-signup [name=username]', 'n_test'); await p.selectOption('#su-country', 'United Kingdom'); await p.fill('#form-signup [name=email]', 'n@test.com'); await p.fill('#form-signup [name=password]', 'Password123'); await p.fill('#form-signup [name=password2]', 'Password123'); await p.fill('#form-signup [name=dob]', '1990-01-01'); await p.click('#form-signup .toggle'); await p.click('#form-signup label:has([name=sensitive]) .toggle');  await p.click('#form-signup [type=submit]'); await p.waitForSelector('.onb');
// skip onboarding via demo db flag
await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('slc_db_v2')); const s = JSON.parse(localStorage.getItem('slc_session_v1')); Object.assign(db.profiles[s.uid], { name: 'N', gender: 'man', intent: 'serious', city: 'London', country: 'United Kingdom', prefs: { seeking: ['woman'], ageMin: 18, ageMax: 60 }, onboarded: true, photos: [] }); localStorage.setItem('slc_db_v2', JSON.stringify(db)); });
await p.goto('http://localhost:8766/#/me'); await p.reload(); await p.waitForSelector('.me-head');
await p.click('#me-prefs'); await p.waitForSelector('.sheet.show');
await p.evaluate(() => __L.backButton()); await p.waitForTimeout(400);
t('back closes open sheet', !(await p.$('.sheet.show')));
await p.evaluate(() => __L.backButton()); await p.waitForTimeout(300);
t('back from Profile goes to Discover', await p.evaluate(() => location.hash === '#/discover'));
await p.evaluate(() => __L.backButton()); await p.waitForTimeout(200);
t('back on Discover minimizes app', await p.evaluate(() => __calls.includes('minimize')));
t('no page errors', !errs.length); if (errs.length) console.log(errs);
// 2) live mode: bundled supabase-js loads (network to supabase is blocked here, so we only check the import + client creation)
const ctx2 = await b.newContext(); const p2 = await ctx2.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
const failed = []; p2.on('requestfailed', r => failed.push(r.url()));
await p2.goto('http://localhost:8766/'); await p2.waitForTimeout(2500);
const loaded = await p2.evaluate(async () => { const m = await import('/js/vendor/supabase-2.49.4.js'); return typeof m.createClient; });
t('bundled supabase-js loads in browser', loaded === 'function');
t('no CDN requests in live mode', !failed.some(u => /jsdelivr/.test(u)));
console.log('   live-mode requests that failed (expected: supabase blocked from this sandbox):', [...new Set(failed.map(u => new URL(u).host))].join(', ') || 'none');
console.log(`${ok} passed, ${bad} failed`); await b.close();
