// Accessibility scan (axe-core, WCAG 2.1 AA) of every main screen in demo mode.
import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const AXE = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const demoCfg = fs.readFileSync((ROOT + '/js/config.js'), 'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const B = 'http://localhost:8766/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: demoCfg }));
await ctx.route('**/fonts.googleapis.com/**', r => r.abort());
const page = await ctx.newPage(); page.setDefaultTimeout(8000);
const all = {};
const scan = async (name) => {
  await page.waitForTimeout(500);
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations
    .map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, ex: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.any[0]?.message || n.all[0]?.message || '').slice(0, 140)) })));
  all[name] = r;
  console.log(`\n=== ${name}: ${r.length} rule(s) failing`);
  for (const v of r) { console.log(` [${v.impact}] ${v.id} ×${v.n} — ${v.help}`); v.ex.forEach(e => console.log('     ', e)); }
};
await page.goto(B); await page.waitForSelector('#tab-signup'); await scan('landing + login');
await page.click('#tab-signup'); await scan('sign-up form');
// member
await page.evaluate(async () => {
  const { getApi } = await import('/js/data/index.js'); const api = await getApi();
  await api.signUp({ email: 'a11y@x.com', password: 'Passw0rd!x', dob: '1992-02-02', gender: 'woman', firstName: 'Ada', lastName: 'K', username: 'ada_k', country: 'Sierra Leone', city: 'Freetown' });
  const d = JSON.parse(localStorage.getItem('slc_db_v2')); const me = Object.values(d.profiles).find(p => p.username === 'ada_k');
  Object.assign(me, { onboarded: true, intent: 'serious', photos: [Object.values(d.profiles)[0].photos[0]], bio: 'Hi there from Freetown, Salone!' });
  localStorage.setItem('slc_db_v2', JSON.stringify(d));
});
await page.goto(B + '#/discover'); await page.reload(); await page.waitForSelector('#cg'); await scan('consent gate');
await page.click('.sheet label:has([name=terms]) .toggle'); await page.click('.sheet label:has([name=sensitive]) .toggle'); await page.click('#cg button.btn-primary'); await page.waitForSelector('.nav');
for (const [hash, name] of [['#/discover', 'discover'], ['#/likes', 'likes'], ['#/chats', 'chats'], ['#/me', 'me']]) { await page.goto(B + hash); await page.reload(); await page.waitForSelector('.nav'); await scan(name); }
// staff
await page.evaluate(() => localStorage.removeItem('slc_session_v1'));
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(B + 'superadmin.html'); await page.waitForSelector('#lf'); await scan('console login');
await page.fill('[name=email]', 'super@slconnect.demo'); await page.fill('[name=password]', 'Super#2026'); await page.click('#lf button'); await page.waitForSelector('.kpis');
for (const t of ['overview', 'reports', 'members', 'health', 'settings']) { await page.goto(B + 'superadmin.html#' + t); await page.reload(); await page.waitForSelector('#main h1'); await scan('console ' + t); }
for (const p of ['privacy.html', 'terms.html', 'cookies.html', 'licenses.html', 'child-safety.html', 'delete-account.html']) { await page.goto(B + p); await scan(p); }
const total = Object.values(all).reduce((n, v) => n + v.length, 0);
console.log(`\nTOTAL failing rule instances: ${total}`);
fs.writeFileSync(new URL('./a11y-report.json', import.meta.url), JSON.stringify(all, null, 1));
await browser.close();
