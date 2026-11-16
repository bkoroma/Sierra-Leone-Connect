import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const demoCfg = fs.readFileSync((ROOT + '/js/config.js'), 'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const OUT = (ROOT + '/tests/.out/shots');
fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:8766/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: demoCfg }));
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', e => { if (!/Boom test|Rejected test/.test(e.message)) errors.push(e.message); });
page.on('dialog', d => { errors.push('native dialog used: ' + d.message()); d.dismiss(); });
let ok = 0, bad = 0;
const step = async (n, fn) => { try { await fn(); ok++; console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '—', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/H-FAIL-${n.replace(/\W+/g, '_').slice(0, 60)}.png` }).catch(() => {}); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('slc_db_v2')));
const setDb = fn => page.evaluate(src => { const d = JSON.parse(localStorage.getItem('slc_db_v2')); new Function('d', src)(d); localStorage.setItem('slc_db_v2', JSON.stringify(d)); }, fn);
const dialogOk = async () => { await page.click('.mdl [data-ok]'); await page.waitForSelector('.ask', { state: 'detached' }); };
const login = async (email, pw) => { await page.fill('[name=email]', email); await page.fill('[name=password]', pw); await page.click('#lf button'); };

// ── Member side first: create a member through the real sign-up API, then use the app ──
let mid;
await step('member: sign up via API + onboarded', async () => {
  await page.goto(B); await page.waitForSelector('#tab-signup');
  mid = await page.evaluate(async () => {
    const { getApi } = await import('/js/data/index.js'); const api = await getApi();
    const u = await api.signUp({ email: 'pwtest@x.com', password: 'OldPass#123', dob: '1993-03-03', gender: 'woman', firstName: 'Ami', lastName: 'Kamara', username: 'ami_k', country: 'Sierra Leone', city: 'Freetown' });
    return u.id;
  });
  await setDb(`Object.assign(d.profiles['${mid}'], { termsVersion: '2026-11-11', termsAcceptedAt: new Date().toISOString(), sensitiveConsentAt: new Date().toISOString(), onboarded: true, intent: 'serious', photos: [d.profiles[Object.keys(d.profiles)[0]].photos[0]], bio: 'Hello there from Freetown!' })`);
  await page.goto(B + '#/me'); await page.reload(); await page.waitForSelector('#me-pw');
});
await step('member: version in footer comes from config (v1.7.0)', async () => { assert(/v1\.7\.0/.test(await page.textContent('#view')), 'version'); });
await step('member: change password — mismatch rejected, then saved; old password stops working', async () => {
  await page.click('#me-pw'); await page.waitForSelector('#pw-f');
  await page.fill('[name=pw]', 'NewPass#456'); await page.fill('[name=pw2]', 'Different#1'); await page.click('#pw-f button');
  assert(/match/.test(await page.textContent('#pw-err')), 'no mismatch error');
  await page.fill('[name=pw2]', 'NewPass#456'); await page.click('#pw-f button'); await page.waitForSelector('#pw-f', { state: 'detached' });
  const r = await page.evaluate(async () => {
    const { getApi } = await import('/js/data/index.js'); const api = await getApi();
    const out = {};
    try { await api.signIn({ email: 'pwtest@x.com', password: 'OldPass#123' }); out.old = 'worked'; } catch { out.old = 'rejected'; }
    try { await api.signIn({ email: 'pwtest@x.com', password: 'NewPass#456' }); out.new = 'worked'; } catch (e) { out.new = e.message; }
    return out;
  });
  assert(r.old === 'rejected' && r.new === 'worked', JSON.stringify(r));
});
await step('member: Help & support shows the configured support e-mail', async () => {
  await setDb(`d.settings.supportEmail = 'help@salone.org'`);
  await page.goto(B + '#/me'); await page.reload(); await page.waitForSelector('#me-help'); await page.click('#me-help'); await page.waitForSelector('#hp-safety');
  const href = await page.getAttribute('.sheet a[href^="mailto:help@salone.org"]', 'href'); assert(href, 'mailto missing');
  await page.screenshot({ path: `${OUT}/H1-help.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
});
await step('member: delete-account sheet (wrong word blocked, cancel keeps account)', async () => {
  await page.click('#me-del'); await page.waitForSelector('#cf-ok');
  await page.fill('#cf-w', 'delete'); await page.click('#cf-ok'); assert(/exactly/.test(await page.textContent('#cf-err')), 'no check');
  await page.screenshot({ path: `${OUT}/H2-delete-sheet.png` });
  await page.click('#cf-no'); await page.waitForTimeout(400); assert((await db()).users[mid], 'deleted on cancel');
});
await step('member: uncaught error is reported to the server log', async () => {
  await page.evaluate(() => setTimeout(() => { throw new Error('Boom test 42'); }, 0));
  await page.evaluate(() => { Promise.reject(new Error('Rejected test 7')); });
  await page.waitForTimeout(500);
  const errs = (await db()).errors || []; assert(errs.some(e => /Boom test/.test(e.message) && e.page === 'app') && errs.some(e => /Rejected test/.test(e.message)), JSON.stringify(errs.map(e => e.message)));
});
await step('member: maintenance blocks an already-open app on its next action', async () => {
  await setDb(`d.settings.maintenance = true`); await page.reload(); await page.waitForSelector('.empty');
  assert(/right back/.test(await page.textContent('#root')), 'no maintenance screen');
  const msg = await page.evaluate(async () => { const { getApi } = await import('/js/data/index.js'); const api = await getApi(); try { await api.settings(); await api.me(); return 'allowed'; } catch (e) { return e.message; } });
  await setDb(`d.settings.maintenance = false`); await page.reload(); assert(/maintenance/.test(msg), msg);
});
await step('member: unmatch uses an in-app confirmation', async () => {
  const d = await db(); const other = Object.values(d.profiles).find(p => p.bot);
  await setDb(`d.matches.push({ id: 'mtest', a: '${mid}', b: '${other.id}', at: new Date().toISOString() })`);
  await page.goto(B + '#/chat/mtest'); await page.reload(); await page.waitForSelector('#c-menu');
  const menuBtn = await page.$('#c-menu'); assert(menuBtn, 'menu button not found');
  await menuBtn.click(); await page.click('[data-x=unmatch]'); await page.waitForSelector('#cf-ok');
  await page.click('#cf-ok'); await page.waitForTimeout(500);
  const m = (await db()).matches.find(x => x.id === 'mtest'); assert(!m || m.unmatched, 'not unmatched');
});

// ── SuperAdmin ──
await step('super: health tab with checks, errors and dashboards', async () => {
  await page.evaluate(() => localStorage.removeItem('slc_session_v1'));
  await page.goto(B + 'superadmin.html'); await page.waitForSelector('#lf'); await login('super@slconnect.demo', 'Super#2026');
  await page.waitForSelector('[data-tab=health]'); await page.click('[data-tab=health]'); await page.waitForSelector('.checks');
  const t = await page.textContent('#main');
  assert(/Database up to date/.test(t) && /Backup SuperAdmin/.test(t) && /Only one SuperAdmin/.test(t), 'checks');
  assert(/Boom test/.test(t) && /Rejected test/.test(t), 'errors list');
  assert(/help@salone\.org/.test(t), 'support email check');
  await page.screenshot({ path: `${OUT}/H3-health.png`, fullPage: true });
});
await step('super: health badge counts issues', async () => { const b = await page.textContent('[data-count=healthIssues]'); assert(Number(b) >= 2, 'badge ' + b); });
await step('super: check link jumps to the right tab', async () => {
  await page.click('.chk:has-text("Backup SuperAdmin") [data-go]'); await page.waitForSelector('#pq');
  await page.click('[data-tab=health]'); await page.waitForSelector('.checks');
});
await step('super: clear error list (audited)', async () => {
  await page.click('#hclear'); await dialogOk(); await page.waitForTimeout(400);
  const d = await db(); assert(!(d.errors || []).length && d.audit.some(a => a.action === 'clear_errors'), 'not cleared');
});
await step('super: settings — invalid support e-mail rejected, valid saved', async () => {
  await page.click('[data-tab=settings]'); await page.waitForSelector('[data-k=supportEmail]');
  await page.fill('[data-k=supportEmail]', 'nope'); await page.click('#save'); await page.waitForSelector('.toast');
  assert(/doesn't look right/.test(await page.textContent('.toast')), 'no error');
  await page.waitForTimeout(300);
  await page.fill('[data-k=supportEmail]', 'Team@Salone.org'); await page.fill('[data-k=safetyEmail]', 'safety@salone.org'); await page.click('#save'); await page.waitForTimeout(400);
  const s = (await db()).settings; assert(s.supportEmail === 'team@salone.org' && s.safetyEmail === 'safety@salone.org', JSON.stringify(s));
});
await step('super: member panel — note, password reset, history', async () => {
  await page.click('[data-tab=members]'); await page.waitForSelector('[data-f=onboarding]');
  await page.fill('#q', 'ami_k'); await page.waitForTimeout(500); await page.click(`[data-member="${mid}"].btn`); await page.waitForSelector('[data-do=note]');
  assert(/Confirmed/.test(await page.textContent('.facts')), 'email field');
  await page.click('[data-do=note]'); await page.fill('.mdl textarea', 'Asked for help with login.'); await dialogOk(); await page.waitForTimeout(300);
  await page.click('[data-do=reset]'); await dialogOk(); await page.waitForTimeout(300);
  const t = await page.textContent('.hist'); assert(/Staff note/.test(t) && /Asked for help with login/.test(t) && /Password reset e-mail sent/.test(t), t.slice(0, 200));
  await page.screenshot({ path: `${OUT}/H4-member-tools.png` });
  await page.click('.mdl-x');
});
await step('super: Still onboarding filter', async () => {
  await setDb(`d.profiles['${mid}'].onboarded = false`); await page.reload(); await page.waitForSelector('[data-f=onboarding]');
  await page.fill('#q', ''); await page.click('[data-f=onboarding]'); await page.waitForTimeout(400);
  const rows = await page.$$('.tbl tbody tr'); assert(rows.length === 1, 'rows ' + rows.length);
});
await step('super: verification queue shows waiting time', async () => {
  await setDb(`d.profiles['${mid}'].verificationStatus = 'pending'; d.profiles['${mid}'].verificationSelfie = d.profiles['${mid}'].photos[0]; d.profiles['${mid}'].verificationRequestedAt = new Date(Date.now() - 2 * 864e5).toISOString()`);
  await page.goto(B + 'superadmin.html#verify'); await page.reload(); await page.waitForSelector('.item'); const t = await page.textContent('#main'); assert(/waiting 2d/.test(t), t.slice(0, 300));
});
await step('super: last SuperAdmin cannot delete own account', async () => {
  const msg = await page.evaluate(async () => { const { getApi } = await import('/js/data/index.js'); const api = await getApi(); try { await api.deleteAccount(); return 'deleted'; } catch (e) { return e.message; } });
  assert(/only SuperAdmin/.test(msg), msg);
});
await step('policy page shows contact e-mails', async () => {
  const p2 = await ctx.newPage(); await p2.goto(B + 'privacy.html'); await p2.waitForTimeout(400);
  const t = await p2.textContent('body'); await p2.close(); assert(/@/.test(t), 'no email');
});
await step('mobile: health tab layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-tab=health]').catch(() => {}); await page.goto(B + 'superadmin.html#health'); await page.waitForSelector('.checks');
  await page.screenshot({ path: `${OUT}/H5-health-mobile.png`, fullPage: true });
  const w = await page.evaluate(() => document.documentElement.scrollWidth); assert(w <= 390, 'horizontal scroll ' + w);
  await page.setViewportSize({ width: 1360, height: 900 });
});
await step('offline service worker keeps index separate from policy pages (sw.js logic)', async () => {
  const src = fs.readFileSync((ROOT + '/sw.js'), 'utf8');
  assert(/index\\\.html\)\?\$/.test(src) && !/x\.put\('\.\/index\.html', c\)\); return r; \}\)\.catch/.test(src), 'sw');
});
console.log(`\n${ok} passed, ${bad} failed`);
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
