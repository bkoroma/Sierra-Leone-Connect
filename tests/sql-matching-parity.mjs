// Matching audit: database deck vs app rules on a random community, plus edge cases.
import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const { eligible, qMatch, score, rankDeck } = await import(ROOT + '/js/match.js');
const { QUESTIONS, CITIES, FAITHS, INTENTS, DISTRICTS } = await import(ROOT + '/js/constants.js');
const core = fs.readFileSync(ROOT + '/supabase/schema.sql', 'utf8').split('-- ═══ SUPABASE-PLATFORM SECTION')[0].replace('create extension if not exists pgcrypto;', '');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz default now(), last_sign_in_at timestamptz, created_at timestamptz not null default now());
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create schema storage; create table storage.buckets (id text primary key); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
insert into storage.buckets values ('photos'), ('voice'), ('verifications');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid(), auth.jwt() to authenticated, anon; grant usage on schema public to authenticated, anon;`);
await db.exec(core);
let rs = Number(process.env.SEED || 12345); const R = () => (rs = rs * 16807 % 2147483647) / 2147483647; const pick = a => a[Math.floor(R() * a.length)];
const yr = new Date().getFullYear();
const N = 60, people = [];
for (let i = 0; i < N; i++) {
  const gender = i % 2 ? 'man' : 'woman', age = 19 + Math.floor(R() * 40), c = pick(CITIES);
  const seeking = R() < .9 ? [gender === 'man' ? 'woman' : 'man'] : (R() < .5 ? ['woman', 'man'] : [gender]);
  const prefs = { seeking, ageMin: Math.max(18, age - 4 - Math.floor(R() * 8)), ageMax: age + 3 + Math.floor(R() * 12), maxKm: pick([25, 100, 500]), faithMatters: R() < .2, sameIntentOnly: R() < .15 };
  if (process.env.NOAGE && R() < .3) { delete prefs.ageMin; delete prefs.ageMax; }
  const answers = {};
  for (const q of QUESTIONS) { if (R() < .45) continue; const m = Math.floor(R() * q.opts.length); answers[q.id] = { m, a: q.opts.map((_, k) => k).filter(k => k === m || R() < .5), i: R() < .07 ? 4 : Math.floor(R() * 4) }; }
  people.push({ id: null, username: 'member' + i, gender, dob: `${yr - age}-0${1 + Math.floor(R() * 8)}-1${Math.floor(R() * 9)}`, intent: pick(INTENTS).id, faith: pick(FAITHS),
    city: c.city, country: c.country, lat: +(c.lat + (R() - .5) * .2).toFixed(2), lng: +(c.lng + (R() - .5) * .2).toFixed(2), homeDistrict: pick(DISTRICTS), prefs, answers, languages: ['Krio'], interests: ['Tech'] });
}
const as = async (id, sql, p = []) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false), set_config('request.jwt.claims','{"aal":"aal1"}',false); set role authenticated;`); try { return (await db.query(sql, p)).rows[0]; } finally { await db.exec('reset role'); } };
for (const p of people) {
  p.id = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [p.username + '@x.com', JSON.stringify({ username: p.username, gender: p.gender, dob: p.dob, first_name: 'X' })])).rows[0].id;
  await as(p.id, `select public.save_profile($1::jsonb)`, [JSON.stringify({ name: 'X', dob: p.dob, gender: p.gender, intent: p.intent, faith: p.faith, city: p.city, country: p.country, lat: p.lat, lng: p.lng, homeDistrict: p.homeDistrict, prefs: p.prefs, onboarded: true, languages: p.languages, interests: p.interests })]);
  for (const [qid, v] of Object.entries(p.answers)) await as(p.id, `select public.save_answer($1,$2,$3,$4)`, [qid, v.m, v.a, v.i]);
}
// read prefs back exactly as the server stored them (clamped / defaulted)
for (const p of people) p.prefs = (await db.query(`select prefs from public.profiles where id = $1`, [p.id])).rows[0].prefs;
let ok = 0, bad = 0; const t = (n, c, x = '') => { c ? ok++ : bad++; console.log(c ? '✓' : '✗', n, c ? '' : x); };
// 1) Deck parity in every mode
const modes = ['worldwide', 'near', 'salone', 'diaspora']; let mism = [], totalDeck = 0;
for (const mode of modes) for (const me of people) {
  const r = await as(me.id, `select public.get_deck($1) r`, [mode]);
  const sqlIds = new Set(r.r.candidates.map(c => c.id)); totalDeck += sqlIds.size;
  const jsIds = new Set(people.filter(o => eligible({ ...me, prefs: { ...me.prefs, mode } }, o, mode)).map(o => o.id));
  for (const id of sqlIds) if (!jsIds.has(id)) mism.push(`${mode}: ${me.username} sees ${people.find(o => o.id === id).username} (db only)`);
  for (const id of jsIds) if (!sqlIds.has(id)) mism.push(`${mode}: ${me.username} should see ${people.find(o => o.id === id).username} (app only)`);
  // score parity for every candidate
  for (const c of r.r.candidates) { const o = people.find(x => x.id === c.id); const js = qMatch(me.answers, o.answers); if (js.pct !== c.q.pct || js.deal !== c.q.deal) mism.push(`q mismatch ${me.username}->${o.username}`); }
}
t(`deck parity across ${modes.length} modes × ${N} members (${totalDeck} deck entries)`, !mism.length, mism.slice(0, 6).join(' | '));
// 2) Invariants on every deck
let viol = [];
for (const me of people) { const r = await as(me.id, `select public.get_deck('worldwide') r`); for (const c of r.r.candidates) { const o = people.find(x => x.id === c.id);
  if (!(me.prefs.seeking || []).includes(o.gender) && (me.prefs.seeking || []).length) viol.push('wrong gender');
  if (!(o.prefs.seeking || []).includes(me.gender) && (o.prefs.seeking || []).length) viol.push('they don\'t seek me');
  if (qMatch(me.answers, o.answers).deal) viol.push('dealbreaker shown');
  if ('lastName' in c || 'firstName' in c || 'answers' in c || 'email' in c) viol.push('private field leaked'); } }
t('deck invariants (gender both ways, dealbreakers, no private fields)', !viol.length, [...new Set(viol)].join(', '));
// 3) Ranking sanity: higher Connect Score first (before random jitter of ≤8)
let rankBad = 0; for (const me of people.slice(0, 20)) { const r = await as(me.id, `select public.get_deck('worldwide') r`); const d = rankDeck(me, r.r.candidates, new Set()); for (let i = 1; i < d.length; i++) if (d[i]._score > d[i - 1]._score + 8) rankBad++; }
t('ranking: no candidate outranked by one scoring >8 points higher', rankBad === 0, rankBad + ' inversions');
// 4) Edge cases on swipe / likes
const [A, B] = [people.find(p => p.gender === 'man' && p.prefs.seeking.join() === 'woman'), null];
const sameGender = people.find(p => p.gender === 'man' && p.id !== A.id && !p.prefs.seeking.includes('man'));
let directLike = 'blocked'; try { await as(A.id, `select public.swipe($1,'like','','')`, [sameGender.id]); directLike = 'ACCEPTED'; } catch {}
t('swipe refuses a profile outside mutual filters (direct API call)', directLike === 'blocked', 'a like to an ineligible profile was ' + directLike);
const tooOld = people.find(p => p.gender === 'woman' && (2026 - +p.dob.slice(0, 4)) > (A.prefs.ageMax + 3));
if (tooOld) { await db.exec(`update public.profiles set prefs = prefs || '{"seeking":["man"],"ageMin":18,"ageMax":99}'::jsonb where id = '${tooOld.id}'`);
  let liked = true; try { await as(tooOld.id, `select public.swipe($1,'like','','')`, [A.id]); } catch { liked = false; }
  const ly = await as(A.id, `select public.likes_you() r`);
  t('Likes You hides people outside my own filters', !ly.r.some(x => x.id === tooOld.id), liked ? 'a like from outside my age range appears in Likes You' : '(like refused upstream)'); }
// 5) defaults
const { defaultPrefs } = await import(ROOT + '/js/match.js');
const d50 = typeof defaultPrefs === 'function' ? defaultPrefs(50) : null;
t('default age range fits the member (50-year-old sees peers)', d50 && d50.ageMin <= 45 && d50.ageMax >= 55, JSON.stringify(d50 && { ageMin: d50.ageMin, ageMax: d50.ageMax }));
// 6) mutual like always creates exactly one match; pass never does
const pairs = []; for (const me of people) { const r = await as(me.id, `select public.get_deck('worldwide') r`); if (r.r.candidates[0]) pairs.push([me, people.find(o => o.id === r.r.candidates[0].id)]); }
let created = 0, wrong = 0;
for (const [x, y] of pairs.slice(0, 15)) { await as(x.id, `select public.swipe($1,'like','','')`, [y.id]).catch(() => {}); const r = await as(y.id, `select public.swipe($1,'like','','') r`, [x.id]).catch(() => null); if (r?.r?.match) created++; }
const dup = (await db.query(`select count(*)::int n from (select least(user_a,user_b), greatest(user_a,user_b), count(*) from public.matches group by 1,2 having count(*) > 1) z`)).rows[0].n;
t(`mutual likes create matches (${created} created, 0 duplicates)`, created > 0 && dup === 0, `dup=${dup}`);
// 7) passes come back after 30 days (second look) — small communities run out of people otherwise
const P = people.find(p => p.id !== A.id && eligible(A, p)); 
if (P) { await as(A.id, `select public.swipe($1,'pass','','')`, [P.id]); await db.exec(`update public.swipes set created_at = now() - interval '31 days' where swiper = '${A.id}' and target = '${P.id}'`);
  const r = await as(A.id, `select public.get_deck('worldwide') r`); t('a pass resurfaces after 30 days', r.r.candidates.some(c => c.id === P.id), 'passed profile never comes back'); }
// 8) Likes You parity: everyone who liked me AND passes my filters (and theirs) — nobody else
for (const p of people) p.prefs = (await db.query(`select prefs from public.profiles where id = $1`, [p.id])).rows[0].prefs;
{ const likers = people.slice(0, 30);
  for (const x of likers) { const r = await as(x.id, `select public.get_deck('worldwide') r`); for (const c of r.r.candidates.slice(0, 4)) await as(x.id, `select public.swipe($1,'like','','')`, [c.id]).catch(() => {}); }
  const sw = (await db.query(`select swiper, target, kind, created_at from public.swipes`)).rows;
  let lm = [];
  for (const me of people) { const r = await as(me.id, `select public.likes_you() r`); const got = new Set(r.r.map(x => x.id));
    const want = new Set(people.filter(o => sw.some(s => s.swiper === o.id && s.target === me.id && s.kind !== 'pass') && !sw.some(s => s.swiper === me.id && s.target === o.id && (s.kind !== 'pass' || Date.now() - new Date(s.created_at) < 30 * 864e5)) && eligible(me, o, 'worldwide')).map(o => o.id));
    for (const id of got) if (!want.has(id)) lm.push(me.username + ' got extra'); for (const id of want) if (!got.has(id)) lm.push(me.username + ' missing'); }
  t('Likes You parity with app rules for all members', !lm.length, lm.slice(0, 5).join(', ')); }
// 9) prefs saved by onboarding match what the filter screen shows
{ const { fullPrefs } = await import(ROOT + '/js/match.js'); const me = people[3]; const shown = fullPrefs(me);
  t('filter screen shows the filters the server uses', shown.ageMin === (me.prefs.ageMin ?? shown.ageMin) && shown.ageMax === (me.prefs.ageMax ?? shown.ageMax)); }
console.log(`\n${ok} passed, ${bad} failed`);
