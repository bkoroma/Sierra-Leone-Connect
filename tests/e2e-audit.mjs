import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const liveCfg = fs.readFileSync((ROOT + '/js/config.js'), 'utf8');
const demoCfg = liveCfg.replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const B = 'http://localhost:8766/';
const browser = await chromium.launch();
let ok = 0, bad = 0; const errors = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const mk = async cfg => { const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } }); await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: cfg })); const page = await ctx.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message)); return page; };
const step = async (n, fn) => { try { await fn(); ok++; console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '—', e.message.split('\n')[0]); } };

let page = await mk(liveCfg);
await step('server unreachable: friendly screen with Try again (no raw error page)', async () => {
  await page.goto(B); await page.waitForSelector('#boot-retry', { timeout: 20000 });
  const t = await page.textContent('body'); assert(/offline|couldn't load/i.test(t) && !/TypeError/.test(t), t.slice(0, 200));
});
await page.context().close();

page = await mk(demoCfg);
await step('reserved username is refused with a clear hint', async () => {
  await page.goto(B); await page.click('#tab-signup');
  await page.fill('#form-signup [name=username]', 'Support_Team'); await page.waitForTimeout(700);
  assert(/reserved/.test(await page.textContent('#su-user-hint')), await page.textContent('#su-user-hint'));
  await page.fill('#form-signup [name=username]', 'kadie_b'); await page.waitForTimeout(900);
  assert(/available/.test(await page.textContent('#su-user-hint')), await page.textContent('#su-user-hint'));
});
await step('sign-up form: tabs wired for screen readers, country hint outside the label', async () => {
  assert(await page.getAttribute('#tab-signup', 'aria-controls') === 'form-signup', 'aria-controls');
  assert(await page.$('div.field > small#su-geo-hint'), 'hint placement'); assert(await page.$('#su-geo'), 'detect button');
});
await step('unmatch is final for the other person; conversation unreadable; block removes my like', async () => {
  const r = await page.evaluate(async () => {
    const { getApi } = await import('/js/data/index.js'); const api = await getApi();
    const u = await api.signUp({ email: 'aud@x.com', password: 'Passw0rd!x', dob: '1994-04-04', gender: 'man', firstName: 'Abu', lastName: 'Kamara', username: 'abu_k', country: 'Sierra Leone', termsVersion: '2026-11-11', sensitiveConsent: true });
    const d = JSON.parse(localStorage.getItem('slc_db_v2')); const bots = Object.values(d.profiles).filter(p => p.bot && p.gender === 'woman');
    const [b1, b2] = bots; const now = new Date().toISOString();
    d.profiles[u.id].onboarded = true;
    d.swipes.push({ from: u.id, to: b1.id, kind: 'like', at: now }, { from: b1.id, to: u.id, kind: 'like', at: now }, { from: u.id, to: b2.id, kind: 'like', at: now });
    d.matches.push({ id: 'aud-m', a: u.id, b: b1.id, at: now });
    localStorage.setItem('slc_db_v2', JSON.stringify(d));
    return { uid: u.id, b1: b1.id, b2: b2.id };
  });
  await page.reload(); await page.waitForTimeout(600);
  const out = await page.evaluate(async ({ uid, b1, b2 }) => {
    const { getApi } = await import('/js/data/index.js'); const api = await getApi(); const o = {};
    await api.unmatch('aud-m');
    try { await api.messages('aud-m'); o.read = 'readable'; } catch (e) { o.read = e.message; }
    let d = JSON.parse(localStorage.getItem('slc_db_v2'));
    o.mySwipe = d.swipes.filter(s => s.from === uid && s.to === b1).map(s => s.kind).join(',');
    await api.block(b2); d = JSON.parse(localStorage.getItem('slc_db_v2'));
    o.likeAfterBlock = d.swipes.filter(s => s.from === uid && s.to === b2 && s.kind !== 'pass').length;
    await api.report(b1, 'Other', 'one'); await api.report(b1, 'Spam or advertising', 'two'); d = JSON.parse(localStorage.getItem('slc_db_v2'));
    o.reports = d.reports.filter(x => x.by === uid && x.target === b1).map(x => x.reason + '/' + x.details).join('|');
    try { await api.report(b1, '  '); o.empty = 'allowed'; } catch (e) { o.empty = e.message; }
    const pub = (await api.matches()); o.leak = JSON.stringify(pub).includes('termsAcceptedAt') || JSON.stringify(await api.deck('worldwide')).includes('sensitiveConsentAt');
    return o;
  }, r);
  assert(/not found/.test(out.read), 'read: ' + out.read); assert(out.mySwipe === 'pass', 'swipe: ' + out.mySwipe);
  assert(out.likeAfterBlock === 0, 'like kept after block'); assert(out.reports === 'Spam or advertising/two', 'reports: ' + out.reports);
  assert(/Choose a reason/.test(out.empty), out.empty); assert(out.leak === false, 'consent fields leak in public profiles');
});
await step('app survives blocked browser storage for preferences', async () => {
  const p2 = await mk(demoCfg);
  await p2.addInitScript(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (k === 'slc_mode') throw new DOMException('denied', 'SecurityError'); return g.call(this, k); }; });
  await p2.goto(B); await p2.waitForSelector('#tab-signup'); assert(!(await p2.$('#boot-retry')), 'boot failed'); await p2.context().close();
});
console.log(`\n${ok} passed, ${bad} failed`); console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); process.exit(bad || errors.length ? 1 : 0);
