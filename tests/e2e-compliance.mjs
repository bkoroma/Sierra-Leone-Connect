import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
(await import('fs')).mkdirSync(ROOT + '/tests/.out/shots', { recursive: true });
const demoCfg = fs.readFileSync((ROOT + '/js/config.js'), 'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const OUT = (ROOT + '/tests/.out/shots');
const B = 'http://localhost:8766/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: demoCfg }));
const page = await ctx.newPage(); page.setDefaultTimeout(8000);
const errors = [], external = new Set();
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
page.on('request', r => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) external.add(u.hostname); });
let ok = 0, bad = 0;
const step = async (n, fn) => { try { await fn(); ok++; console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '—', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/C-FAIL-${n.replace(/\W+/g, '_').slice(0, 50)}.png` }).catch(() => {}); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('slc_db_v2')));
const setDb = fn => page.evaluate(src => { const d = JSON.parse(localStorage.getItem('slc_db_v2')); new Function('d', src)(d); localStorage.setItem('slc_db_v2', JSON.stringify(d)); }, fn);

await step('landing: no third-party requests (fonts self-hosted)', async () => {
  await page.goto(B); await page.waitForSelector('#tab-signup'); await page.waitForTimeout(800);
  assert(!external.size, 'external hosts: ' + [...external].join(', '));
  const fam = await page.evaluate(() => document.fonts.check('16px "DM Sans"')); assert(fam, 'DM Sans not loaded');
});
await step('landing: no unsupported claims, says Free', async () => {
  const t = await page.textContent('body'); assert(!/30\+|districts represented|verified adults only/.test(t), 'old claims'); assert(/no fees or subscriptions/.test(t), 'free');
});
await step('landing footer links: cookies + licences', async () => { assert(await page.$('footer a[href="cookies.html"]') && await page.$('footer a[href="licenses.html"]'), 'links'); });
await step('sign-up requires the sensitive-data consent; consent recorded', async () => {
  await page.click('#tab-signup');
  await page.fill('#su-first, [name=firstName]', 'Fatu').catch(() => {});
  await page.evaluate(() => {
    const f = document.querySelector('#form-signup') || document.querySelector('form:has([name=password2])');
    const set = (n, v) => { const el = f.querySelector(`[name=${n}]`); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('firstName', 'Fatu'); set('lastName', 'Sesay'); set('username', 'fatu_s'); set('email', 'fatu@x.com'); set('password', 'Passw0rd!x'); set('password2', 'Passw0rd!x'); set('dob', '1995-05-05');
    f.querySelector('[name=gender][value=woman]').checked = true;
    const c = f.querySelector('[name=country]'); c.value = 'Sierra Leone'; c.dispatchEvent(new Event('change', { bubbles: true }));
    f.querySelector('[name=agree]').checked = true;
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => (document.querySelector('[name=password2]').closest('form')).requestSubmit());
  await page.waitForTimeout(400);
  assert(/how we use the details/.test(await page.textContent('#signup-err')), 'no consent error: ' + await page.textContent('#signup-err'));
  await page.evaluate(() => { document.querySelector('[name=sensitive]').checked = true; document.querySelector('[name=password2]').closest('form').requestSubmit(); });
  await page.waitForSelector('#landing.hidden', { state: 'attached', timeout: 8000 });
  const p = Object.values((await db()).profiles).find(x => x.username === 'fatu_s');
  assert(p.termsVersion === '2026-11-11' && p.sensitiveConsentAt && p.termsAcceptedAt, JSON.stringify([p.termsVersion, p.sensitiveConsentAt]));
  assert(!(await page.$('#cg')), 'consent gate shown after consenting at sign-up');
});
let mid;
await step('existing member without consent: gate cannot be dismissed, needs both switches', async () => {
  mid = Object.values((await db()).profiles).find(x => x.username === 'fatu_s').id;
  await setDb(`Object.assign(d.profiles['${mid}'], { onboarded: true, intent: 'serious', photos: [Object.values(d.profiles)[0].photos[0]], bio: 'Hello from Freetown!', termsVersion: '2025-01-01' })`);
  await page.goto(B + '#/discover'); await page.reload(); await page.waitForSelector('#cg');
  assert(/updated our terms/.test(await page.textContent('#cg')), 'update wording');
  await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(400); assert(await page.$('#cg'), 'dismissed');
  await page.screenshot({ path: `${OUT}/C1-consent.png` });
  await page.click('.sheet label:has([name=terms]) .toggle'); await page.click('#cg button.btn-primary');
  assert(/both/.test(await page.textContent('#cg-err')), 'no error');
  await page.click('.sheet label:has([name=sensitive]) .toggle'); await page.click('#cg button.btn-primary'); await page.waitForSelector('.nav');
  const p = (await db()).profiles[mid]; assert(p.termsVersion === '2026-11-11', p.termsVersion);
  await page.reload(); await page.waitForSelector('.nav'); await page.waitForTimeout(400); assert(!(await page.$('#cg')), 'shown again');
});
await step('Download my data: JSON with my data only', async () => {
  await page.goto(B + '#/me'); await page.waitForSelector('#me-data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#me-data')]);
  const x = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert(x.profile.username === 'fatu_s' && x.account.email === 'fatu@x.com' && x.account.termsVersion === '2026-11-11' && Array.isArray(x.messagesISent), 'shape');
  assert(!/@slconnect\.demo/.test(JSON.stringify(x)), 'other emails leaked');
});
await step('no "2× more matches" claim; footer links', async () => {
  const t = await page.textContent('#view'); assert(!/2×|3×/.test(t), 'claim'); assert(await page.$('#view a[href="cookies.html"]'), 'cookies link');
});
await step('keyboard: sheet traps focus, Escape returns focus to the button', async () => {
  await page.focus('#me-help'); await page.keyboard.press('Enter'); await page.waitForSelector('#hp-safety');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  assert(await page.evaluate(() => !!document.activeElement.closest('.sheet')), 'focus left the sheet');
  assert(await page.evaluate(() => document.querySelector('.sheet').getAttribute('aria-labelledby')), 'sheet unnamed');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.activeElement?.id === 'me-help'), 'focus not restored: ' + await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
});
await step('keyboard: arrow keys swipe on Discover; focus ring visible', async () => {
  await page.goto(B + '#/discover'); await page.waitForSelector('.card[tabindex="0"]');
  const first = await page.getAttribute('.card[tabindex="0"]', 'data-id');
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(700);
  const next = await page.getAttribute('.card[tabindex="0"]', 'data-id'); assert(next && next !== first, 'did not swipe');
  await page.keyboard.press('Tab'); const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle); assert(outline !== 'none', 'no focus ring');
});
await step('banned member can still delete their account; e-mail hash blocks re-registering (demo)', async () => {
  await setDb(`d.users['${mid}'].status = 'banned'`);
  await page.evaluate(() => localStorage.removeItem('slc_session_v1'));
  await page.goto(B + 'delete-account.html'); await page.waitForSelector('#del');
  await page.fill('#del [name=email]', 'fatu@x.com'); await page.fill('#del [name=password]', 'Passw0rd!x'); await page.fill('#del [name=confirm]', 'DELETE');
  await page.click('#del button'); await page.waitForSelector('#del-done:not(.hidden)');
  const d = await db(); assert(!d.users[mid] && (d.bannedEmails || []).length === 1, 'not deleted / no hash');
  assert(!JSON.stringify(d.bannedEmails).includes('fatu'), 'plain email');
  const again = await page.evaluate(async () => { const { getApi } = await import('/js/data/index.js'); const api = await getApi();
    try { await api.signUp({ email: 'fatu@x.com', password: 'Passw0rd!x', dob: '1995-05-05', gender: 'woman', firstName: 'F', lastName: 'S', username: 'fatu_again', country: 'Sierra Leone' }); return 'ok'; } catch (e) { return e.message; } });
  assert(/can't be used/.test(again), again);
});
// Staff
await step('console: business details saved and shown on legal pages', async () => {
  await page.evaluate(() => localStorage.removeItem('slc_session_v1')); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(B + 'superadmin.html'); await page.waitForSelector('#lf');
  await page.fill('[name=email]', 'super@slconnect.demo'); await page.fill('[name=password]', 'Super#2026'); await page.click('#lf button'); await page.waitForSelector('.kpis');
  await page.goto(B + 'superadmin.html#settings'); await page.reload(); await page.waitForSelector('[data-k=operatorName]');
  await page.fill('[data-k=operatorName]', 'Koroma Digital <b>'); await page.click('#save'); await page.waitForSelector('.toast'); assert(/can't contain/.test(await page.textContent('.toast')), 'html allowed');
  await page.waitForTimeout(400);
  await page.fill('[data-k=operatorName]', 'Koroma Digital LLC'); await page.fill('[data-k=operatorAddress]', '123 Main St, New Carrollton, MD 20784, USA'); await page.fill('[data-k=operatorCountry]', 'the United States (Maryland)');
  await page.click('#save'); await page.waitForTimeout(500);
  const s = (await db()).settings; assert(s.operatorName === 'Koroma Digital LLC' && s.operatorCountry, JSON.stringify(s));
  const p2 = await ctx.newPage(); await p2.goto(B + 'terms.html'); await p2.waitForTimeout(500); const t = await p2.textContent('main');
  await p2.screenshot({ path: `${OUT}/C2-terms.png` }); await p2.close();
  assert(/Koroma Digital LLC/.test(t) && /123 Main St/.test(t) && /United States \(Maryland\)/.test(t) && /free/i.test(t), 'terms details');
});
await step('health: business details + consent checks present', async () => {
  await page.goto(B + 'superadmin.html#health'); await page.reload(); await page.waitForSelector('.checks');
  const t = await page.textContent('.checks'); assert(/Business details on legal pages/.test(t) && /Koroma Digital LLC/.test(t) && /Member consent records/.test(t) && /Schema 17/.test(t), t.slice(0, 300));
});
await step('verification decision deletes the selfie', async () => {
  await page.goto(B + 'superadmin.html#verify'); await page.reload(); await page.waitForSelector('[data-v][data-ok="1"]');
  const id = await page.getAttribute('[data-v][data-ok="1"]', 'data-v'); await page.click('[data-v][data-ok="1"]'); await page.waitForTimeout(400);
  const p = (await db()).profiles[id]; assert(p.verified && !p.verificationSelfie, 'selfie kept');
});
await step('underage reports are shown first with a priority tag', async () => {
  await setDb(`d.reports.push({ id: 'u18', by: Object.keys(d.profiles)[3], target: Object.keys(d.profiles)[4], reason: 'Underage', details: 'Says she is 16', status: 'open', at: new Date(Date.now() - 864e5).toISOString() })`);
  await page.goto(B + 'superadmin.html#reports'); await page.reload(); await page.waitForSelector('.item');
  const first = await page.textContent('.item'); assert(/Child safety — priority/.test(first) && /Underage/.test(first), first.slice(0, 120));
});
await step('legal pages: cookies, licences, font licence file', async () => {
  for (const [u, re] of [['cookies.html', /don't use advertising, tracking or analytics cookies/], ['licenses.html', /SIL Open Font License/], ['privacy.html', /Sensitive information/], ['fonts/OFL-DM-Sans.txt', /Open Font License/]]) {
    const r = await page.goto(B + u); assert(r.ok(), u + ' ' + r.status()); assert(re.test(await page.textContent('body')), u);
  }
});
console.log(`\n${ok} passed, ${bad} failed`);
console.log('External hosts contacted:', external.size ? [...external] : 'none');
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
