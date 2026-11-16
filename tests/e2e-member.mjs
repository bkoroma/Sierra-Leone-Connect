import { chromium } from 'playwright';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const __demoCfg = (await import('fs')).readFileSync((ROOT + '/js/config.js'),'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");

import fs from 'fs';
const OUT = (ROOT + '/tests/.out/shots11'); fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:8766/';
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: __demoCfg }));
const page = await ctx.newPage(); page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
let pass = 0, fail = 0;
const step = async (n, fn) => { try { await fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message.split('\n')[0]); await shot('FAIL-' + n.replace(/\W+/g, '_')); } };
const sleep = ms => page.waitForTimeout(ms);
const dismiss = async () => { if (await page.$('.match-modal')) await page.click('#m-keep'); };
const closeSheet = async () => { await page.keyboard.press('Escape'); await sleep(400); };

await page.goto(B); await page.evaluate(() => localStorage.clear()); await page.reload();
await step('signup', async () => {
  await page.click('#tab-signup');
  await page.check('#form-signup [name=gender][value=man]', { force: true }); await page.fill('#form-signup [name=firstName]', 'JB'); await page.fill('#form-signup [name=lastName]', 'Koroma'); await page.fill('#form-signup [name=username]', 'jb_test'); await page.selectOption('#su-country', 'United States');
  await page.fill('#form-signup [name=email]', 'jb@test.com'); await page.fill('#form-signup [name=password]', 'Password123'); await page.fill('#form-signup [name=password2]', 'Password123');
  await page.fill('#form-signup [name=dob]', '1995-05-05'); await page.click('#form-signup .toggle'); await page.click('#form-signup label:has([name=sensitive]) .toggle'); await page.click('#form-signup [type=submit]');
  await page.waitForSelector('.onb');
});
await step('onboarding basics→interests', async () => {
  await page.fill('#f-name', 'JB'); await page.click('#f-gender [data-v=man]'); if ((await page.getAttribute('#f-seek [data-v=woman]', 'aria-pressed')) !== 'true') throw new Error('Show me not defaulted to Women'); await page.fill('#f-job', 'Developer'); await page.click('#onb-next');
  await page.selectOption('#f-dist', 'Bo'); await page.selectOption('#f-her', 'Mende'); await page.selectOption('#f-faith', 'Muslim'); await page.click('#f-lang [data-v=Mende]'); await page.click('#onb-next');
  await page.fill('#f-cq', 'carroll'); await page.click('#f-cities button'); await page.click('#onb-next');
  await page.click('#f-int [data-v=serious]'); await page.click('#onb-next');
  for (const v of ['Afrobeats', 'Tech', 'Cooking', 'Travel', 'Leone Stars football']) await page.click(`#f-ints [data-v="${v}"]`);
  await page.click('#onb-next');
});
await step('onboarding questions requires 5', async () => {
  await page.waitForSelector('.qcard');
  await shot('01-q-empty');
  await page.click('#onb-next'); await sleep(300);
  if (!(await page.$('.qcard'))) throw new Error('advanced without answers');
  for (let i = 0; i < 6; i++) {
    await page.click('.qopt >> nth=0');
    if (i === 0) { await page.click('.imp [data-i="3"]'); await shot('02-q-filled'); }
    if (i === 1) { await page.click('#qa [data-a="1"]'); }
    await page.click('[data-save]'); await sleep(150);
  }
  const t = await page.textContent('.tip'); if (!/6 of/.test(t)) throw new Error(t);
  await page.click('#onb-next');
});
await step('onboarding prompts+photos', async () => {
  const tas = await page.$$('.prompt-card textarea'); await tas[0].fill('Good food and honest talk'); await tas[1].fill('Cassava leaf with rice'); await page.click('#onb-next');
  await page.setInputFiles('[data-add="0"]', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForSelector('.ph-slot.has'); await page.fill('#f-bio', 'Builder, Salone pikin, love good music and family.'); await page.click('#onb-next');
  await page.waitForSelector('.card');
});
await sleep(1200);
await step('question of the day shown + grants Oya', async () => {
  await page.waitForSelector('#dq .qnudge.gold');
  await shot('03-discover-qotd');
  const before = await page.textContent('#quota');
  await page.click('#dq-b'); await page.waitForSelector('.qotd-h');
  await page.click('.sheet .qopt >> nth=1'); await page.click('.sheet [data-save]'); await sleep(700);
  const after = await page.textContent('#quota');
  if (!/4 Oya/.test(after)) throw new Error(before + ' → ' + after);
  if (await page.$('#dq .qnudge')) throw new Error('qotd still shown');
});
await step('card shows question-based reasons', async () => {
  const txt = await page.textContent('.card[tabindex] .reasons');
  console.log('   reasons:', txt.trim().slice(0, 90));
});
await step('profile sheet compat section + like with comment', async () => {
  await page.click('.card[tabindex] [data-more]'); await page.waitForSelector('.sheet.show');
  await page.waitForSelector('.sheet .pv-sec h4:has-text("COMPATIBILITY")');
  await sleep(300); await shot('04-profile-compat');
  await page.click('.sheet .pv-prompt .likeit'); await page.waitForSelector('#lc');
  await page.fill('#lc', 'Cassava leaf is the correct answer 😄'); await shot('05-like-comment');
  await page.click('#lc-like'); await sleep(900); await dismiss();
});
await step('comment with phone is blocked', async () => {
  await page.click('.card[tabindex] [data-more]'); await page.waitForSelector('.sheet .likeit');
  await page.click('.sheet .likeit >> nth=0'); await page.waitForSelector('#lc');
  const id = await page.getAttribute('.card[tabindex]', 'data-id');
  await page.fill('#lc', 'call me on +232 76 123 456'); await page.click('#lc-like'); await sleep(700);
  if ((await page.getAttribute('.card[tabindex]', 'data-id')) !== id) throw new Error('card advanced');
  const t = await page.textContent('#toast'); if (!/contact/.test(t)) throw new Error(t);
});
await step('likes tab shows comments from likers', async () => {
  await page.click('.nav a[data-r=likes]'); await page.waitForSelector('#lk .tile');
  await sleep(300); await shot('06-likes');
  console.log('   comments visible:', (await page.$$('.tile .cmt')).length);
});
await step('swipe until match (not expiring if bot greets)', async () => {
  await page.click('.nav a[data-r=discover]'); await page.waitForSelector('.card[tabindex]');
  let matched = false;
  for (let i = 0; i < 25 && !matched; i++) { await page.click('#acts [data-a=like]'); await sleep(650); matched = !!(await page.$('.match-modal')); }
  if (!matched) throw new Error('no match');
  await shot('07-match');
  await page.click('#m-keep');
});
await step('chats: expiry countdown on a fresh match', async () => {
  // keep liking until we have a match with no messages
  for (let i = 0; i < 30; i++) {
    await page.click('.nav a[data-r=chats]'); await page.waitForSelector('#chats-root .conv, #chats-root .nm, #chats-root .empty');
    if (await page.$('.nm .exp')) break;
    await page.click('.nav a[data-r=discover]'); await page.waitForSelector('.card[tabindex]');
    for (let k = 0; k < 4; k++) { await page.click('#acts [data-a=like]'); await sleep(600); if (await page.$('.match-modal')) { await page.click('#m-keep'); } }
  }
  await page.waitForSelector('.nm .exp'); await shot('08-chats-expiry');
});
await step('extend match', async () => {
  await page.click('.nm >> nth=0'); await page.waitForSelector('.exp-box');
  await page.click('#c-extend'); await sleep(400);
  const t = await page.textContent('.exp-box'); if (!/6d|7d|9d|10d/.test(t) || /Extend 3 days/.test(t)) throw new Error(t);
});
await step('send text → Seen + typing + reply', async () => {
  await page.fill('#ct', 'Kushɛ! How di body?'); await page.click('.composer .send');
  await page.waitForSelector('.seen', { timeout: 5000 });
  await page.waitForSelector('.typing', { timeout: 6000 });
  await shot('09-typing');
  await page.waitForSelector('.bubble.them:not(.typing)', { timeout: 8000 });
});
await step('This or That game round-trip', async () => {
  await page.click('#c-game'); await page.waitForSelector('.sheet [data-a]'); await page.click('.sheet [data-a] >> nth=0'); await sleep(400);
  await page.waitForSelector('.tot'); await page.click('.tot .tot-opt >> nth=0');
  await page.waitForSelector('.tot-r:has-text("Same pick"), .tot-r:has-text("Opposites")', { timeout: 9000 });
  await shot('10-game');
});
await step('voice note record + send + play', async () => {
  await page.click('#c-mic'); await page.waitForSelector('#rs-rec'); await page.click('#rs-rec'); await sleep(1800); await page.click('#rs-rec');
  await page.waitForSelector('#rs-use:not(.hidden)'); await shot('11-recorder'); await page.click('#rs-use');
  await page.waitForSelector('.vbubble'); await page.click('.vbubble .vplay >> nth=-1'); await sleep(400);
  await shot('12-voice-bubble');
});
await step('voice intro on profile', async () => {
  await page.click('.chat-head a'); await page.click('.nav a[data-r=me]'); await page.waitForSelector('[data-edit=voice]');
  await page.click('[data-edit=voice]'); await page.waitForSelector('#rs-rec'); await page.click('#rs-rec'); await sleep(1500); await page.click('#rs-rec');
  await page.waitForSelector('#rs-use:not(.hidden)'); await page.click('#rs-use'); await sleep(600);
  const t = await page.textContent('[data-edit=voice]'); if (!/Recorded/.test(t)) throw new Error(t);
  await page.click('#me-prev'); await page.waitForSelector('.sheet [data-voice]'); await closeSheet();
});
await step('questions bank: category edit + dealbreaker', async () => {
  await page.click('[data-edit=questions]'); await page.waitForSelector('[data-cat]'); await shot('13-q-bank');
  await page.click('[data-cat="3"]'); await page.waitForSelector('[data-q]'); await page.click('[data-q="smoke"]');
  await page.waitForSelector('.qcard'); await page.click('.qopt >> nth=0'); await page.click('.imp [data-i="4"]');
  await page.waitForSelector('.tip:has-text("won\'t be shown")'); await page.click('[data-save]'); await sleep(400);
  await page.waitForSelector('[data-q="smoke"]:has-text("Dealbreaker")');
  await closeSheet();
});
await step('dealbreaker removes smokers from deck', async () => {
  const smokers = await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('slc_db_v2')); return Object.values(db.profiles).filter(p => p.answers?.smoke && p.answers.smoke.m !== 0).map(p => p.id); });
  await page.click('.nav a[data-r=discover]'); await page.waitForSelector('.card, .empty');
  const deckIds = await page.evaluate(async () => { const m = await import('/js/data/index.js'); const api = await m.getApi(); return (await api.deck('worldwide')).candidates.map(c => c.id); });
  const leak = deckIds.filter(id => smokers.includes(id));
  if (leak.length) throw new Error('smokers in deck: ' + leak.join(','));
  console.log(`   ${smokers.length} smokers hidden, deck=${deckIds.length}`);
});
await step('me page', async () => { await page.click('.nav a[data-r=me]'); await page.waitForSelector('.me-head'); await sleep(300); await shot('14-me'); });
await step('relogin keeps answers', async () => {
  await page.click('#me-out'); await page.waitForSelector('#landing:not(.hidden)');
  await page.fill('#form-login [name=email]', 'jb@test.com'); await page.fill('#form-login [name=password]', 'Password123'); await page.click('#form-login [type=submit]');
  await page.waitForSelector('.nav'); await page.click('.nav a[data-r=me]'); await page.waitForSelector('.card-sec:has-text("Stand out") [data-edit=questions]');
  const t = await page.textContent('.card-sec:has-text("Stand out") [data-edit=questions]'); if (!/8 of/.test(t)) throw new Error(t);
});
console.log(`\n${pass} passed, ${fail} failed`);
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
