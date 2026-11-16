import { chromium } from 'playwright'; import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
(await import('fs')).mkdirSync(ROOT + '/tests/.out/shots', { recursive: true });
const B = 'http://localhost:8766/';
const demoCfg = fs.readFileSync((ROOT + '/js/config.js'), 'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
const OUT = (ROOT + '/tests/.out');
const b = await chromium.launch();
let ok = 0, bad = 0; const t = (n, c, x = '') => { c ? ok++ : bad++; console.log(c ? '✓' : '✗', n, c ? '' : x); };
async function ctxWith(opts) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...opts });
  await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'text/javascript', body: demoCfg }));
  const p = await ctx.newPage(); p.setDefaultTimeout(9000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('#landing:not(.hidden)');
  return { p, errs, ctx };
}
// 1) GPS allowed in Silver Spring, MD
{
  const { p, errs } = await ctxWith({ geolocation: { latitude: 38.9907, longitude: -77.0261 }, permissions: ['geolocation'], timezoneId: 'America/New_York' });
  await p.click('#tab-signup');
  await p.waitForSelector('#su-geo-hint.ok');
  t('GPS → country auto-selected', (await p.inputValue('#su-country')) === 'United States', await p.inputValue('#su-country'));
  t('GPS → city detected in hint', /Silver Spring/.test(await p.textContent('#su-geo-hint')), await p.textContent('#su-geo-hint'));
  t('249 countries in list', (await p.$$eval('#su-country option', o => o.length)) === 250);
  await p.fill('[name=firstName]', 'Aminata'); await p.fill('[name=lastName]', 'Kamara');
  await p.click('#form-signup [name=gender][value=woman]');
  t('gender pick selectable', await p.isChecked('#form-signup [name=gender][value=woman]'));
  await p.fill('[name=username]', 'Fatmata.7'); await p.waitForTimeout(600);
  t('taken username flagged', /taken/.test(await p.textContent('#su-user-hint')), await p.textContent('#su-user-hint'));
  t('username lowercased as you type', (await p.inputValue('[name=username]')) === 'fatmata.7');
  await p.fill('[name=username]', 'a..b'); await p.waitForTimeout(500);
  t('invalid username explained', /letters, numbers/.test(await p.textContent('#su-user-hint')));
  await p.fill('[name=username]', 'aminata_k'); await p.waitForTimeout(600);
  t('free username confirmed', /available/.test(await p.textContent('#su-user-hint')));
  await p.fill('#form-signup [name=email]', 'aminata@test.com'); await p.fill('#form-signup [name=password]', 'Password123'); await p.fill('#form-signup [name=dob]', '1996-04-27');
  await p.fill('#form-signup [name=password2]', 'Password12');
  t('mismatch shown live', /don't match/.test(await p.textContent('#su-pw-hint')));
  await p.click('#form-signup .toggle'); await p.click('#form-signup [type=submit]'); await p.waitForTimeout(300);
  t('mismatch blocks sign-up', /don't match/.test(await p.textContent('#signup-err')) && !(await p.$('.onb')));
  await p.click('#form-signup .toggle');
  await p.fill('#form-signup [name=password2]', 'Password123');
  t('match confirmed live', /match/.test(await p.textContent('#su-pw-hint')) && /✓/.test(await p.textContent('#su-pw-hint')));
  await p.screenshot({ path: OUT + '/signup_form.png', fullPage: false });
  await p.locator('#auth').screenshot({ path: OUT + '/signup_card.png' });
  await p.click('#form-signup [type=submit]'); await p.waitForTimeout(300);
  t('agree required', /agree/.test(await p.textContent('#signup-err')));
  await p.click('#form-signup .toggle'); await p.click('#form-signup [type=submit]'); await p.waitForTimeout(300);
  t('sensitive-data consent required', /how we use the details/.test(await p.textContent('#signup-err')));
  await p.click('#form-signup label:has([name=sensitive]) .toggle'); await p.click('#form-signup [type=submit]');
  await p.waitForSelector('.onb');
  t('onboarding: first name prefilled', (await p.inputValue('#f-name')) === 'Aminata');
  t('onboarding: DOB prefilled', (await p.inputValue('#f-dob')) === '1996-04-27');
  t('onboarding: gender prefilled', (await p.getAttribute('#f-gender [data-v=woman]', 'aria-pressed')) === 'true');
  t('onboarding: Show me defaults to Men', (await p.getAttribute('#f-seek [data-v=man]', 'aria-pressed')) === 'true');
  const prof = await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('slc_db_v2')); return Object.values(db.profiles).find(x => x.username === 'aminata_k'); });
  t('profile saved: last name, username, country, city, ~1km coords', prof && prof.lastName === 'Kamara' && prof.gender === 'woman' && prof.country === 'United States' && prof.city === 'Silver Spring, MD' && prof.lat === 38.99, JSON.stringify(prof && { l: prof.lastName, c: prof.country, ci: prof.city, lat: prof.lat }));
  await p.click('#onb-next');
  await p.selectOption('#f-dist', 'Bo'); await p.click('#onb-next');
  t('onboarding location: city pre-selected', /Silver Spring/.test(await p.textContent('#f-cur')), await p.textContent('#f-cur'));
  const pub = await p.evaluate(async () => { const m = await import('/js/data/index.js'); const api = await m.getApi(); const s = JSON.parse(localStorage.getItem('slc_session_v1')); const db = JSON.parse(localStorage.getItem('slc_db_v2')); return Object.keys(db.profiles[s.uid]); });
  t('no page errors (GPS run)', !errs.length, errs.join(' | '));
}
// 2) Location denied, device timezone Freetown → Sierra Leone
{
  const { p, errs } = await ctxWith({ timezoneId: 'Africa/Freetown' });
  await p.click('#tab-signup'); await p.waitForSelector('#su-geo-hint.ok', { timeout: 15000 });
  t('denied GPS → timezone guess Sierra Leone', (await p.inputValue('#su-country')) === 'Sierra Leone', await p.inputValue('#su-country'));
  t('hint says guessed from time zone', /time zone/.test(await p.textContent('#su-geo-hint')));
  await p.selectOption('#su-country', 'Ghana');
  t('manual country change respected', (await p.inputValue('#su-country')) === 'Ghana' && /manually/.test(await p.textContent('#su-geo-hint')));
  await p.fill('#form-signup [name=firstName]', 'Kadi'); await p.fill('#form-signup [name=lastName]', 'Conteh'); await p.fill('#form-signup [name=username]', 'kadi_c');
  await p.fill('#form-signup [name=email]', 'k@test.com'); await p.fill('#form-signup [name=password]', 'Password123'); await p.fill('#form-signup [name=password2]', 'Password123'); await p.fill('#form-signup [name=dob]', '1995-01-01');
  await p.click('#form-signup .toggle'); await p.click('#form-signup [type=submit]'); await p.waitForTimeout(400);
  t('gender required', /gender/i.test(await p.textContent('#signup-err')) && !(await p.$('.onb')), await p.textContent('#signup-err'));
  t('no page errors (timezone run)', !errs.length, errs.join(' | '));
}
// 3) Last name never exposed to other members
{
  const { p } = await ctxWith({ timezoneId: 'Europe/London' });
  const leak = await p.evaluate(async () => {
    const m = await import('/js/data/index.js'); const api = await m.getApi();
    await api.signUp({ email: 'x@test.com', password: 'Password123', dob: '1990-01-01', gender: 'man', firstName: 'Musa', lastName: 'Sesay', username: 'musa_s', country: 'United Kingdom' });
    await api.saveProfile({ gender: 'man', intent: 'serious', city: 'London', prefs: { seeking: ['woman'], ageMin: 18, ageMax: 60 }, onboarded: true });
    await api.signOut();
    await api.signUp({ email: 'y@test.com', password: 'Password123', dob: '1992-01-01', gender: 'woman', firstName: 'Isha', lastName: 'Bangura', username: 'isha_b', country: 'United Kingdom' });
    await api.saveProfile({ gender: 'woman', intent: 'serious', city: 'London', prefs: { seeking: ['man'], ageMin: 18, ageMax: 60 }, onboarded: true });
    const d = await api.deck('worldwide'); const musa = d.candidates.find(c => c.username === 'musa_s');
    return { found: !!musa, name: musa && musa.name, json: JSON.stringify(d) };
  });
  t('other members see only the username (no first or last name)', leak.found && leak.name === 'musa_s' && !/Musa|Sesay/.test(leak.json), leak.name);
}
console.log(`\n${ok} passed, ${bad} failed`); await b.close();
