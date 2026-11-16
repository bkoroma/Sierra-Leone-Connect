import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const demoCfg = fs.readFileSync((ROOT + '/js/config.js'), 'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const OUT = (ROOT + '/tests/.out/shots');
fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:8766/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: demoCfg }));
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => { errors.push('native dialog used: ' + d.message()); d.dismiss(); });
let ok = 0, bad = 0;
const step = async (n, fn) => { try { await fn(); ok++; console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '—', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/B-FAIL-${n.replace(/\W+/g, '_')}.png` }).catch(() => {}); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const login = async (email, pw) => { await page.fill('[name=email]', email); await page.fill('[name=password]', pw); await page.click('#lf button'); };
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('slc_db_v2')));
const dialogOk = async () => { await page.click('.mdl [data-ok]'); await page.waitForSelector('.ask', { state: 'detached' }); };
const toastText = async () => (await page.waitForSelector('.toast')).textContent();

// ───────── Admin ─────────
await step('admin login + new KPIs', async () => {
  await page.goto(B + 'admin.html'); await page.waitForSelector('#lf'); await login('admin@slconnect.demo', 'Admin#2026'); await page.waitForSelector('.kpis');
  const t = await page.textContent('.kpis'); assert(/Suspended/.test(t) && /New this week/.test(t), t);
});
let reported = {};
await step('reports show reported member + warn via dialog closes report and stores warning', async () => {
  await page.click('[data-tab=reports]'); await page.waitForSelector('[data-a=warn]');
  const d = await db(); const r = d.reports.find(x => x.status === 'open'); reported = r;
  const before = (await page.$$('[data-a=dismiss]')).length;
  await page.click(`[data-r="${r.id}"][data-a=warn]`); await page.waitForSelector('.mdl textarea');
  await page.screenshot({ path: `${OUT}/B1-warn-dialog.png` });
  await page.fill('.mdl textarea', 'Please never ask matches for money.'); await dialogOk();
  await page.waitForFunction(n => document.querySelectorAll('[data-a=dismiss]').length === n - 1, before);
  const d2 = await db(); assert(d2.profiles[r.target].notice === 'Please never ask matches for money.', 'notice ' + d2.profiles[r.target].notice);
  assert(d2.reports.find(x => x.id === r.id).resolution === 'warn', 'resolution');
});
await step('report → suspend 14 days', async () => {
  const d = await db(); const r = d.reports.find(x => x.status === 'open');
  await page.click(`[data-r="${r.id}"][data-a=suspend]`); await page.waitForSelector('.mdl select[name=days]');
  await page.selectOption('.mdl select[name=days]', '14'); await dialogOk(); await page.waitForTimeout(300);
  const u = (await db()).users[r.target]; assert(u.status === 'suspended' && new Date(u.suspendedUntil) > Date.now() + 13.9 * 864e5, JSON.stringify(u));
});
await step('cancelling a dialog does nothing', async () => {
  const d = await db(); const r = d.reports.find(x => x.status === 'open');
  await page.click(`[data-r="${r.id}"][data-a=ban]`); await page.waitForSelector('.mdl [data-x]'); await page.click('.mdl [data-x]'); await page.waitForTimeout(200);
  assert((await db()).reports.find(x => x.id === r.id).status === 'open', 'changed');
});
await step('report → ban closes the member’s other open reports', async () => {
  const d = await db(); const r = d.reports.find(x => x.status === 'open');
  await page.evaluate(t => { const d = JSON.parse(localStorage.getItem('slc_db_v2')); d.reports.push({ id: 'extra-r', by: Object.keys(d.profiles)[1], target: t, reason: 'Other', details: 'second', status: 'open', at: new Date().toISOString() }); localStorage.setItem('slc_db_v2', JSON.stringify(d)); }, r.target);
  await page.reload(); await page.waitForSelector(`[data-r="${r.id}"][data-a=ban]`);
  await page.click(`[data-r="${r.id}"][data-a=ban]`); await dialogOk(); await page.waitForTimeout(300);
  const d2 = await db(); assert(d2.users[r.target].status === 'banned', 'banned'); assert(d2.reports.find(x => x.id === 'extra-r').status === 'actioned', 'other report open');
});
await step('report history tab shows handled reports', async () => {
  await page.click('[data-s=actioned]'); await page.waitForTimeout(300); const n = (await page.$$('.item')).length; assert(n >= 3, 'actioned ' + n);
  await page.screenshot({ path: `${OUT}/B2-reports-actioned.png` });
});
await step('verification approve', async () => {
  await page.click('[data-tab=verify]'); await page.waitForSelector('[data-v]'); const id = await page.getAttribute('[data-v][data-ok="1"]', 'data-v');
  await page.click('[data-v][data-ok="1"]'); await page.waitForTimeout(300); assert((await db()).profiles[id].verified === true, 'not verified');
});
await step('scam shield → warn sender clears the flag', async () => {
  await page.click('[data-tab=shield]'); await page.waitForSelector('[data-w]'); const sid = await page.getAttribute('[data-w]', 'data-w');
  await page.click('[data-w]'); await page.waitForSelector('.mdl textarea'); await dialogOk(); await page.waitForTimeout(300);
  const d = await db(); assert(d.profiles[sid].notice, 'no notice'); assert(!d.messages.some(m => m.flagged?.length && !m.cleared), 'flag remains');
});
let target;
await step('members: filters + search', async () => {
  await page.click('[data-tab=members]'); await page.waitForSelector('.tbl tbody tr');
  await page.click('[data-f=suspended]'); await page.waitForTimeout(300); let rows = await page.$$('.tbl tbody tr'); assert(rows.length === 1, 'suspended ' + rows.length);
  await page.click('[data-f=banned]'); await page.waitForTimeout(300); rows = await page.$$('.tbl tbody tr'); assert(rows.length === 1, 'banned ' + rows.length);
  await page.click('[data-f=staff]'); await page.waitForTimeout(300); rows = await page.$$('.tbl tbody tr'); assert(rows.length === 2, 'staff ' + rows.length);
  await page.click('[data-f=all]'); await page.waitForTimeout(300);
  const d = await db(); target = Object.values(d.profiles).find(p => !p.staff && p.photos?.length >= 3 && p.bio && d.users[p.id].status === 'active');
  await page.fill('#q', target.username || target.name); await page.waitForTimeout(600);
  rows = await page.$$('.tbl tbody tr'); assert(rows.length >= 1, 'search none');
  assert(!(await page.$('#csv')), 'admin sees CSV export');
  await page.screenshot({ path: `${OUT}/B3-members.png` });
});
await step('member detail opens with profile, counts, history', async () => {
  await page.click(`[data-member="${target.id}"].btn`); await page.waitForSelector('.mem-head');
  const t = await page.textContent('.mem'); assert(/likes sent/.test(t) && /Staff history/.test(t) && /Photos/.test(t), 'content');
  assert(!(await page.$('[data-do=delete]')), 'admin can delete');
  await page.screenshot({ path: `${OUT}/B4-member.png` });
});
await step('remove a photo + clear bio from the detail panel', async () => {
  const n = target.photos.length;
  await page.click('[data-photo="1"]'); await dialogOk(); await page.waitForTimeout(300);
  await page.click('[data-do=clear_bio]'); await dialogOk(); await page.waitForTimeout(300);
  const p = (await db()).profiles[target.id]; assert(p.photos.length === n - 1 && p.photos[1] === target.photos[2] && !p.bio, JSON.stringify([p.photos.length, p.bio]));
  const t = await page.textContent('.hist'); assert(/photo removed/.test(t) && /bio cleared/.test(t), 'history ' + t.slice(0, 200));
});
await step('timed suspension from the detail panel, then reinstate', async () => {
  await page.click('[data-do=suspend]'); await page.selectOption('.mdl select[name=days]', '3'); await page.fill('.mdl input[name=reason]', 'Spam links'); await dialogOk(); await page.waitForTimeout(300);
  let u = (await db()).users[target.id]; assert(u.status === 'suspended' && u.statusReason === 'Spam links' && u.suspendedUntil, JSON.stringify(u));
  assert(/until/.test(await page.textContent('.mem-head')), 'until not shown');
  await page.click('[data-do=reinstate]'); await dialogOk(); await page.waitForTimeout(300);
  u = (await db()).users[target.id]; assert(u.status === 'active' && !u.suspendedUntil && !u.statusReason, 'reinstate');
});
await step('reason is required for suspension', async () => {
  await page.click('[data-do=suspend]'); await page.fill('.mdl input[name=reason]', ''); await page.click('.mdl [data-ok]');
  assert(/required/.test(await page.textContent('.mdl .err')), 'no validation'); await page.click('.mdl [data-x]');
  await page.waitForSelector('.ask', { state: 'detached' });
});
await step('warn from the detail panel shows as unread warning', async () => {
  await page.click('[data-do=warn]'); await page.fill('.mdl textarea', 'Keep it respectful please.'); await dialogOk(); await page.waitForTimeout(300);
  assert(/Unread warning/.test(await page.textContent('.mem')), 'not shown');
});
await step('revoke verification', async () => {
  await page.click('.mdl-x'); await page.waitForTimeout(200);
  const d = await db(); const v = Object.values(d.profiles).find(p => !p.staff && p.verified && d.users[p.id].status === 'active' && p.id !== target.id);
  await page.fill('#q', v.username || v.name); await page.waitForTimeout(600); await page.click(`[data-member="${v.id}"].btn`); await page.waitForSelector('[data-do=revoke]');
  await page.click('[data-do=revoke]'); await dialogOk(); await page.waitForTimeout(300);
  assert((await db()).profiles[v.id].verified === false, 'still verified'); await page.click('.mdl-x');
});
await step('admin cannot act on staff (no action bar)', async () => {
  await page.fill('#q', ''); await page.click('[data-f=staff]'); await page.waitForTimeout(400);
  const d = await db(); const sup = Object.values(d.users).find(u => u.role === 'superadmin');
  await page.click(`[data-member="${sup.id}"].btn`); await page.waitForSelector('.mem');
  assert(!(await page.$('.mem-acts')) && /Only a SuperAdmin/.test(await page.textContent('.mem')), 'acts visible'); await page.click('.mdl-x');
});
await step('Escape closes the panel', async () => {
  await page.click('[data-f=all]'); await page.waitForTimeout(300); await page.click('.tbl [data-member].btn'); await page.waitForSelector('.mdl'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  assert(!(await page.$('.mdl')), 'still open');
});
await step('admin kept out of SuperAdmin console', async () => { await page.goto(B + 'superadmin.html'); await page.waitForSelector('#so'); });

// ───────── SuperAdmin ─────────
await step('super login', async () => { await page.click('#so'); await page.waitForSelector('#lf'); await login('super@slconnect.demo', 'Super#2026'); await page.waitForSelector('[data-tab=settings]'); });
await step('analytics: totals, likes line, gender', async () => {
  await page.click('[data-tab=analytics]'); await page.waitForSelector('.chart'); const t = await page.textContent('#main');
  assert(/Finished onboarding/.test(t) && /Gender/.test(t) && /Likes/.test(t), t.slice(0, 200)); await page.screenshot({ path: `${OUT}/B5-analytics.png` });
});
await step('members CSV export (super)', async () => {
  await page.click('[data-tab=members]'); await page.waitForSelector('#csv');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8'); assert(/^﻿Username,First name/.test(txt) && txt.split('\r\n').length > 40, txt.slice(0, 80));
});
await step('super deletes an account (typed confirmation)', async () => {
  const d = await db(); const victim = Object.values(d.profiles).find(p => !p.staff && d.users[p.id].status === 'banned');
  await page.click('[data-f=banned]'); await page.waitForTimeout(300); await page.click(`[data-member="${victim.id}"].btn`); await page.waitForSelector('[data-do=delete]');
  await page.click('[data-do=delete]'); await page.waitForSelector('.mdl input[name=_confirm]');
  await page.fill('.mdl input[name=_confirm]', 'wrong'); await page.click('.mdl [data-ok]'); assert(/exactly/.test(await page.textContent('.mdl .err')), 'no confirm check');
  await page.fill('.mdl input[name=_confirm]', victim.username || 'DELETE'); await dialogOk(); await page.waitForTimeout(400);
  const d2 = await db(); assert(!d2.users[victim.id] && !d2.profiles[victim.id], 'not deleted'); assert(!(await page.$('.mdl')), 'panel open');
  assert(d2.audit.some(a => a.action === 'delete_user' && a.meta.emailHash && !a.meta.email), 'audit');
});
await step('staff: promote via dialog', async () => {
  await page.click('[data-tab=staff]'); await page.waitForSelector('#pq'); await page.fill('#pq', target.username || target.name);
  await page.waitForSelector('#pr [data-role=admin]'); await page.click('#pr [data-role=admin]'); await dialogOk(); await page.waitForTimeout(300);
  assert((await db()).users[target.id].role === 'admin', 'not promoted');
  await page.click(`[data-id="${target.id}"][data-role=user]`); await dialogOk(); await page.waitForTimeout(300);
  assert((await db()).users[target.id].role === 'user', 'not demoted');
});
await step('settings: pause sign-ups (shown on the app sign-up form), 2FA-off confirmation', async () => {
  await page.click('[data-tab=settings]'); await page.waitForSelector('[data-k=signupsOpen]', { state: 'attached' });
  await page.click('label:has([data-k=signupsOpen]) .toggle'); await page.click('#save'); await page.waitForTimeout(300);
  assert((await db()).settings.signupsOpen === false, 'not saved');
  await page.click('label:has([data-k=requireAdminMfa]) .toggle'); await page.click('#save'); await page.waitForSelector('.mdl'); await page.click('.mdl [data-x]'); await page.waitForTimeout(200);
  assert((await db()).settings.requireAdminMfa === true, '2FA turned off without confirmation');
  const sess = await page.evaluate(() => { const s = localStorage.getItem('slc_session_v1'); localStorage.removeItem('slc_session_v1'); return s; });
  const p2 = await ctx.newPage(); await p2.goto(B); await p2.waitForSelector('#tab-signup');
  await p2.click('#tab-signup'); const t = await p2.textContent('#signup-err'); await p2.close();
  await page.evaluate(s => localStorage.setItem('slc_session_v1', s), sess); assert(/paused/.test(t), 'signup msg: ' + t);
  await page.click('[data-tab=settings]'); await page.waitForSelector('[data-k=signupsOpen]', { state: 'attached' }); await page.click('label:has([data-k=signupsOpen]) .toggle'); await page.click('#save'); await page.waitForTimeout(300);
  assert((await db()).settings.signupsOpen === true, 'not reopened');
});
await step('audit: filter by action, search, CSV', async () => {
  await page.click('[data-tab=audit]'); await page.waitForSelector('#af');
  await page.selectOption('#af', 'warn'); await page.waitForTimeout(200); const n = (await page.$$('.tbl tbody tr')).length; assert(n === 3, 'warn rows ' + n);
  await page.selectOption('#af', ''); await page.fill('#aq', 'Spam links'); await page.waitForTimeout(300); const m = (await page.$$('.tbl tbody tr')).length; assert(m === 1, 'search rows ' + m);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#acsv')]); assert(/Spam links/.test(fs.readFileSync(await dl.path(), 'utf8')), 'csv');
  await page.screenshot({ path: `${OUT}/B6-audit.png` });
});
await step('mobile: member panel is a bottom sheet', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-tab=members]'); await page.waitForSelector('[data-f=all]'); await page.click('[data-f=all]'); await page.waitForSelector('.tbl [data-member].btn');
  await page.click('.tbl [data-member].btn'); await page.waitForSelector('.mem-head'); await page.screenshot({ path: `${OUT}/B7-mobile-member.png` });
  const box = await page.$eval('.mdl', e => e.getBoundingClientRect().toJSON()); assert(box.width === 390 && Math.round(box.bottom) === 844, JSON.stringify(box));
  await page.click('.mdl-x'); await page.setViewportSize({ width: 1360, height: 900 });
});

// ───────── Member side ─────────
const asMember = async (id) => { await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('slc_db_v2')); d.profiles[id].onboarded = true; Object.assign(d.profiles[id], { termsVersion: '2026-11-11', termsAcceptedAt: new Date().toISOString(), sensitiveConsentAt: new Date().toISOString() }); localStorage.setItem('slc_db_v2', JSON.stringify(d)); localStorage.setItem('slc_session_v1', JSON.stringify({ uid: id, at: Date.now() })); }, id); await page.goto(B); };
await step('warned member sees the warning once and acknowledges it', async () => {
  await asMember(target.id); await page.waitForSelector('#notice-ok');
  assert(/Keep it respectful please/.test(await page.textContent('.notice-text')), 'text'); await page.screenshot({ path: `${OUT}/B8-member-warning.png` });
  await page.click('#notice-ok'); await page.waitForTimeout(400);
  assert(!(await db()).profiles[target.id].notice, 'not acked'); await page.reload(); await page.waitForSelector('.nav'); await page.waitForTimeout(500); assert(!(await page.$('#notice-ok')), 'shown again');
});
await step('suspended member is told when the suspension ends', async () => {
  const d = await db(); const s = Object.values(d.users).find(u => u.status === 'suspended');
  await asMember(s.id); await page.waitForSelector('#login-err'); await page.waitForFunction(() => /suspended until/.test(document.querySelector('#login-err').textContent));
  await page.screenshot({ path: `${OUT}/B9-suspended.png` });
  await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('slc_db_v2')); d.users[id].suspendedUntil = new Date(Date.now() - 6e4).toISOString(); localStorage.setItem('slc_db_v2', JSON.stringify(d)); localStorage.setItem('slc_session_v1', JSON.stringify({ uid: id, at: Date.now() })); }, s.id);
  await page.goto(B); await page.waitForSelector('.nav'); assert((await db()).users[s.id].status === 'active', 'not lifted');
});
console.log(`\n${ok} passed, ${bad} failed`);
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
