import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const full = fs.readFileSync((ROOT + '/supabase/schema.sql'), 'utf8');
const core = full.split('-- ═══ SUPABASE-PLATFORM SECTION')[0].replace('create extension if not exists pgcrypto;', '');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz default now(), last_sign_in_at timestamptz, created_at timestamptz not null default now());
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create schema storage; create table storage.buckets (id text primary key); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
insert into storage.buckets values ('photos'), ('voice'), ('verifications');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
grant usage on schema public to authenticated, anon;
`);
await db.exec(core);
console.log('✓ schema applied');

const ids = {};
for (const [k, e] of [['a', 'a@x.com'], ['b', 'b@x.com'], ['c', 'c@x.com'], ['s', 's@x.com']]) {
  ids[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [e])).rows[0].id;
}
await db.exec(`update public.profiles set role='superadmin' where email='s@x.com'`);
let ok = 0, bad = 0;
async function as(who, sql, params = [], aal = 'aal1') {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ids[who]}', false), set_config('request.jwt.claims', '{"aal":"${aal}"}', false); set role authenticated;`);
  params = params.map(x => typeof x === 'string' ? x.replaceAll('__ME__', ids[who]) : x);
  try { return (await db.query(sql, params)).rows[0]; } finally { await db.exec('reset role'); }
}
const t = async (name, fn) => { try { await fn(); ok++; console.log('✓', name); } catch (e) { bad++; console.log('✗', name, '—', e.message); } };
const expectErr = async (name, fn, re) => t(name, async () => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw e; } throw new Error('expected error'); });
const prof = (g, seek, extra = {}) => JSON.stringify({ name: 'N' + g, dob: '1995-01-01', gender: g, intent: 'serious', city: 'London', country: 'United Kingdom', lat: 51.5, lng: -0.12, homeDistrict: 'Bo', languages: ['Krio'], interests: ['Tech', 'Afrobeats', 'Travel'], prompts: [{ q: 'a', a: 'b' }], photos: ['https://proj.supabase.co/storage/v1/object/public/photos/__ME__/p1.jpg'], bio: 'hello there', prefs: { seeking: [seek], ageMin: 18, ageMax: 60 }, onboarded: true, ...extra });

await t('save_profile A/B/C', async () => {
  await as('a', `select public.save_profile($1::jsonb) r`, [prof('man', 'woman')]);
  await as('b', `select public.save_profile($1::jsonb) r`, [prof('woman', 'man')]);
  await as('c', `select public.save_profile($1::jsonb) r`, [prof('woman', 'man', { country: 'Sierra Leone', city: 'Freetown', lat: 8.48, lng: -13.23 })]);
});
await expectErr('underage rejected', () => as('a', `select public.save_profile('{"dob":"2015-01-01"}'::jsonb)`), /18\+/);
await expectErr('bad photo url rejected', () => as('a', `select public.save_profile('{"photos":["javascript:alert(1)"]}'::jsonb)`), /Invalid photo/);
await expectErr('role not writable via save_profile', async () => { await as('a', `select public.save_profile('{"role":"superadmin"}'::jsonb)`); const r = await as('a', `select public.my_session() r`); if (r.r.role !== 'user') return; throw new Error('noop-ok'); }, /noop-ok/);
await expectErr('direct table read blocked', () => as('a', `select * from public.profiles`), /permission denied/);
await expectErr('direct swipe insert blocked', () => as('a', `insert into public.swipes values ($1,$2,'like')`, [ids.a, ids.b]), /permission denied/);
await t('deck for A has B and C', async () => { const r = await as('a', `select public.get_deck('worldwide') r`); if (r.r.candidates.length !== 2) throw new Error(JSON.stringify(r.r)); if ('email' in r.r.candidates[0]) throw new Error('email leaked'); });
await t('deck salone mode = C only', async () => { const r = await as('a', `select public.get_deck('salone') r`); if (r.r.candidates.length !== 1 || r.r.candidates[0].id !== ids.c) throw new Error(JSON.stringify(r.r.candidates.map(x => x.name))); });
await t('deck near mode = B only', async () => { const r = await as('a', `select public.get_deck('near') r`); if (r.r.candidates.length !== 1 || r.r.candidates[0].id !== ids.b) throw new Error('got ' + r.r.candidates.length); });
let matchId;
await t('B likes A (no match), A appears likedMe', async () => { const r = await as('b', `select public.swipe($1,'like') r`, [ids.a]); if (r.r.match) throw new Error('early match'); const d = await as('a', `select public.get_deck('worldwide') r`); if (!d.r.likedMe.includes(ids.b)) throw new Error('likedMe missing'); const l = await as('a', `select public.likes_you() r`); if (l.r.length !== 1) throw new Error('likes_you'); });
await t('A likes B → match', async () => { const r = await as('a', `select public.swipe($1,'like') r`, [ids.b]); if (!r.r.match) throw new Error('no match'); matchId = r.r.match.id; });
await t('my_matches', async () => { const r = await as('b', `select public.my_matches() r`); if (r.r.length !== 1) throw new Error(JSON.stringify(r.r)); });
await t('send + scam shield', async () => { const r = await as('a', `select public.send_message($1,$2) r`, [matchId, 'Please send money via Western Union, whatsapp me +232 76 123456']); if (r.r.flagged.length < 3) throw new Error(JSON.stringify(r.r.flagged)); });
await t('clean message not flagged', async () => { const r = await as('b', `select public.send_message($1,$2) r`, [matchId, 'Kushe! How di body? Cassava leaf or potato leaf?']); if (r.r.flagged.length) throw new Error(JSON.stringify(r.r.flagged)); });
await t('unread + get_messages', async () => { const m = await as('b', `select public.my_matches() r`); if (m.r[0].unread !== 1) throw new Error('unread ' + m.r[0].unread); const g = await as('b', `select public.get_messages($1) r`, [matchId]); if (g.r.items.length !== 2) throw new Error('msgs'); const m2 = await as('b', `select public.my_matches() r`); if (m2.r[0].unread !== 0) throw new Error('not read'); });
await expectErr('C cannot read A/B chat', () => as('c', `select public.get_messages($1)`, [matchId]), /not found/);
await expectErr('C cannot send into A/B chat', () => as('c', `select public.send_message($1,'hi')`, [matchId]), /only message your matches/);
await t('RLS: C sees 0 messages via select', async () => { const r = await as('c', `select count(*)::int n from public.messages`); if (r.n !== 0) throw new Error(r.n); const r2 = await as('a', `select count(*)::int n from public.messages`); if (r2.n !== 2) throw new Error('a sees ' + r2.n); });
await t('quota + undo', async () => { await as('a', `select public.swipe($1,'pass')`, [ids.c]); const u = await as('a', `select public.undo_swipe() r`); if (u.r.id !== ids.c) throw new Error('undo'); const q = await as('a', `select public.quota() r`); if (q.r.likesLeft !== 49) throw new Error(JSON.stringify(q.r)); });
await expectErr('undo blocked after match', async () => { await as('a', `select public.swipe($1,'like')`, [ids.c]); await as('c', `select public.swipe($1,'like')`, [ids.a]); await as('c', `select public.undo_swipe()`); }, /already matched/);
await t('report + block', async () => { await as('b', `select public.report_user($1,'Asking for money / scam','x', null)`, [ids.a]); await as('b', `select public.block_user($1)`, [ids.a]); const m = await as('b', `select public.my_matches() r`); if (m.r.length) throw new Error('match still visible'); });
await expectErr('blocked user cannot message', () => as('a', `select public.send_message($1,'hi')`, [matchId]), /only message your matches|can't message/);
await expectErr('member cannot call admin', () => as('a', `select public.admin_stats()`), /Not authorized/);
await expectErr('superadmin needs aal2', () => as('s', `select public.admin_stats()`), /aal2/);
await t('superadmin aal2 stats', async () => { const r = await as('s', `select public.admin_stats() r`, [], 'aal2'); if (r.r.openReports !== 1 || r.r.flagged !== 1) throw new Error(JSON.stringify(r.r)); });
await t('promote B to admin; admin works', async () => { await as('s', `select public.super_set_role($1,'admin')`, [ids.b], 'aal2'); await as('b', `select public.admin_reports('open') r`, [], 'aal2'); });
await expectErr('admin cannot set roles', () => as('b', `select public.super_set_role($1,'admin')`, [ids.c], 'aal2'), /Not authorized/);
await expectErr('admin cannot ban superadmin', () => as('b', `select public.admin_set_status($1,'banned','x')`, [ids.s], 'aal2'), /SuperAdmin/);
await t('resolve report → ban A', async () => { const r = await as('s', `select public.admin_reports('open') r`, [], 'aal2'); await as('s', `select public.admin_resolve_report($1,'ban','')`, [r.r[0].id], 'aal2'); });
await expectErr('banned A locked out', () => as('a', `select public.get_me()`), /banned/);
await t('flagged + clear', async () => { const f = await as('s', `select public.admin_flagged() r`, [], 'aal2'); await as('s', `select public.admin_clear_flag($1)`, [f.r[0].id], 'aal2'); });
await t('settings save + clamp', async () => { const r = await as('s', `select public.super_save_settings('{"minAge":12,"dailyLikes":5,"announcement":"hi"}'::jsonb) r`, [], 'aal2'); if (r.r.minAge !== 18 || r.r.dailyLikes !== 5) throw new Error(JSON.stringify(r.r)); });
await t('analytics + audit', async () => { const a = await as('s', `select public.super_analytics() r`, [], 'aal2'); if (a.r.days.length !== 14) throw new Error('days'); const l = await as('s', `select public.super_audit() r`, [], 'aal2'); if (l.r.length < 4) throw new Error('audit ' + l.r.length); });
await t('verification flow', async () => { await as('c', `select public.request_verification($1)`, [`verifications/${ids.c}/s.jpg`]); const v = await as('s', `select public.admin_verifications() r`, [], 'aal2'); if (v.r.length !== 1) throw new Error('pending'); await as('s', `select public.admin_decide_verification($1,true)`, [ids.c], 'aal2'); });
await expectErr('selfie path for other user rejected', () => as('c', `select public.request_verification($1)`, [`verifications/${ids.a}/s.jpg`]), /Invalid selfie/);
await t('streak', async () => { const r = await as('c', `select public.touch_streak() r`); if (r.r !== 1) throw new Error(r.r); });
await t('anon can read settings only', async () => { await db.exec(`set role anon`); const r = (await db.query(`select public.get_settings() r`)).rows[0]; await db.exec('reset role'); if (!r.r.dailyLikes) throw new Error('x'); });
await expectErr('anon cannot get_deck', async () => { await db.exec(`set role anon`); try { await db.query(`select public.get_deck('worldwide')`); } finally { await db.exec('reset role'); } }, /permission denied/);
await t('delete account cascades', async () => { await as('c', `select public.delete_account()`); const n = (await db.query(`select count(*)::int n from public.profiles where id=$1`, [ids.c])).rows[0].n; if (n) throw new Error('still there'); });

// ───────── v1.1 features ─────────
const { qMatch } = await import((ROOT + '/js/match.js'));
const { QUESTIONS } = await import((ROOT + '/js/constants.js'));
for (const [k, e] of [['d', 'd@x.com'], ['e', 'e@x.com'], ['f', 'f@x.com']]) ids[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [e])).rows[0].id;
await as('d', `select public.save_profile($1::jsonb)`, [prof('man', 'woman')]);
await as('e', `select public.save_profile($1::jsonb)`, [prof('woman', 'man')]);
await as('f', `select public.save_profile($1::jsonb)`, [prof('woman', 'man')]);
await expectErr('unknown question rejected', () => as('d', `select public.save_answer('nope',0,'{0}',2)`), /Unknown question/);
await expectErr('out-of-range answer rejected', () => as('d', `select public.save_answer('kids_want',9,'{0}',2)`), /Invalid answer/);
await expectErr('empty accept rejected', () => as('d', `select public.save_answer('kids_want',0,'{9}',2)`), /at least one/);
await expectErr('answers table not directly readable', () => as('d', `select * from public.answers`), /permission denied/);
let rs = 7; const rnd = () => (rs = rs * 16807 % 2147483647) / 2147483647;
const randAns = () => { const out = {}; for (const q of QUESTIONS) { if (rnd() < .35) continue; const m = Math.floor(rnd() * q.opts.length); out[q.id] = { m, a: q.opts.map((_, k) => k).filter(k => k === m || rnd() < .4), i: Math.floor(rnd() * 4) }; } return out; };
await t('JS ↔ SQL score parity (20 random pairs)', async () => {
  for (let round = 0; round < 20; round++) {
    const A = randAns(), Bx = randAns();
    await db.exec(`delete from public.answers where user_id in ('${ids.d}','${ids.e}')`);
    for (const [who, ans] of [['d', A], ['e', Bx]]) for (const [qid, v] of Object.entries(ans)) await as(who, `select public.save_answer($1,$2,$3,$4)`, [qid, v.m, v.a, v.i]);
    const sql = (await db.query(`select public._qmatch($1,$2) r`, [ids.d, ids.e])).rows[0].r;
    const js = qMatch(A, Bx);
    if (sql.pct !== js.pct || sql.n !== js.n || sql.deal !== js.deal || JSON.stringify(sql.agree) !== JSON.stringify(js.agree)) throw new Error(`round ${round}: sql=${JSON.stringify(sql)} js=${JSON.stringify(js)}`);
  }
});
await t('get_me returns answers + count; completeness counts them', async () => { const r = await as('d', `select public.get_me() r`); if (r.r.answersCount !== Object.keys(r.r.answers).length || r.r.answersCount < 5) throw new Error(JSON.stringify(r.r.answersCount)); });
await t('deck carries q for each candidate', async () => { const r = await as('d', `select public.get_deck('worldwide') r`); const e = r.r.candidates.find(c => c.id === ids.e); if (!e?.q || e.q.n < 3) throw new Error(JSON.stringify(e?.q)); if ('answers' in e) throw new Error('answers leaked'); });
await t('dealbreaker hides from deck both ways', async () => {
  await db.exec(`delete from public.answers where user_id in ('${ids.d}','${ids.f}')`);
  await as('d', `select public.save_answer('smoke',0,'{0}',4)`); await as('f', `select public.save_answer('smoke',2,'{0,1,2}',1)`);
  const r1 = await as('d', `select public.get_deck('worldwide') r`); if (r1.r.candidates.some(c => c.id === ids.f)) throw new Error('f visible to d');
  await as('f', `select public.save_answer('smoke',0,'{0,1,2}',1)`);
  const r2 = await as('d', `select public.get_deck('worldwide') r`); if (!r2.r.candidates.some(c => c.id === ids.f)) throw new Error('f still hidden after non-smoker');
});
await t('QOTD grants +1 Oya', async () => { const q0 = await as('e', `select public.quota() r`); await as('e', `select public.save_answer('alcohol',0,'{0}',2,true)`); const q1 = await as('e', `select public.quota() r`); if (q1.r.supersLeft !== q0.r.supersLeft + 1 || !q1.r.qotdDone) throw new Error(JSON.stringify([q0.r, q1.r])); });
await expectErr('comment with phone rejected', () => as('e', `select public.swipe($1,'like','call me +232 76 123456','x')`, [ids.d]), /contact details/);
let m2;
await t('like with comment → match → comments become first messages', async () => {
  await as('e', `select public.swipe($1,'like','Cassava leaf is the correct answer','your answer to "x"')`, [ids.d]);
  const l = await as('d', `select public.likes_you() r`); const me_ = l.r.find(x => x.id === ids.e); if (me_?.comment !== 'Cassava leaf is the correct answer') throw new Error(JSON.stringify(l.r));
  const r = await as('d', `select public.swipe($1,'super','You too!','your photo') r`, [ids.e]); m2 = r.r.match.id;
  const g = await as('d', `select public.get_messages($1) r`, [m2]);
  if (g.r.items.length !== 2 || g.r.items[0].from !== ids.e || !/Liked your answer/.test(g.r.items[0].ctx)) throw new Error(JSON.stringify(g.r.items));
  const mm = await as('d', `select public.my_matches() r`); if (mm.r.find(x => x.id === m2).expiresAt !== null) throw new Error('should not expire');
});
await t('read receipt: otherReadAt set after other opens', async () => { await as('e', `select public.get_messages($1)`, [m2]); const g = await as('d', `select public.get_messages($1) r`, [m2]); if (!g.r.otherReadAt) throw new Error('no read'); });
await t('voice note path validated + stored', async () => {
  const r = await as('d', `select public.send_message($1,'', 'voice', $2) r`, [m2, `${m2}/abc-123.webm`]); if (r.r.kind !== 'voice' || r.r.body !== '🎤 Voice note') throw new Error(JSON.stringify(r.r));
});
await expectErr('voice path for another match rejected', () => as('d', `select public.send_message($1,'', 'voice', $2)`, [m2, `${matchId}/x.webm`]), /Invalid voice/);
let gid;
await t('This or That: send + answer once each', async () => {
  const g = await as('d', `select public.send_message($1,'', 'game', null, '{"a":"Jollof rice","b":"Cassava leaf"}'::jsonb) r`, [m2]); gid = g.r.id;
  await as('e', `select public.send_message($1,'', 'game_ans', null, $2::jsonb)`, [m2, JSON.stringify({ ref: gid, pick: 1 })]);
  await as('d', `select public.send_message($1,'', 'game_ans', null, $2::jsonb)`, [m2, JSON.stringify({ ref: gid, pick: 1 })]);
});
await expectErr('game answer twice rejected', () => as('e', `select public.send_message($1,'', 'game_ans', null, $2::jsonb)`, [m2, JSON.stringify({ ref: gid, pick: 0 })]), /already answered/);
await expectErr('invented game pair rejected', () => as('d', `select public.send_message($1,'', 'game', null, '{"a":"<img src=x>","b":"y"}'::jsonb)`, [m2]), /Bad game/);
await expectErr('unknown kind rejected', () => as('d', `select public.send_message($1,'hi','html')`, [m2]), /Bad message type/);
await t('match expiry: fresh match w/o messages has expiresAt; extend once; expired hidden', async () => {
  for (const k of ['g', 'h']) ids[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [k + '@x.com'])).rows[0].id;
  await as('g', `select public.save_profile($1::jsonb)`, [prof('man', 'woman')]); await as('h', `select public.save_profile($1::jsonb)`, [prof('woman', 'man')]);
  await as('g', `select public.swipe($1,'like')`, [ids.h]); const r = await as('h', `select public.swipe($1,'like') r`, [ids.g]); const mid = r.r.match.id;
  let mm = await as('g', `select public.my_matches() r`); const x = mm.r.find(z => z.id === mid); if (!x.expiresAt) throw new Error('no expiry');
  const e1 = await as('g', `select public.extend_match($1) r`, [mid]); if (new Date(e1.r.expiresAt) - new Date(x.expiresAt) < 2.9 * 864e5) throw new Error('not extended');
  let twice = false; try { await as('h', `select public.extend_match($1)`, [mid]); } catch { twice = true; } if (!twice) throw new Error('extended twice');
  await db.exec(`update public.matches set expires_at = now() - interval '1 hour' where id = '${mid}'`);
  mm = await as('g', `select public.my_matches() r`); if (mm.r.some(z => z.id === mid)) throw new Error('expired still visible');
});
await t('voice intro must be https', async () => { let bad = false; try { await as('d', `select public.save_profile('{"voice":"javascript:x"}'::jsonb)`); } catch { bad = true; } if (!bad) throw new Error('accepted'); await as('d', `select public.save_profile($1::jsonb)`, [JSON.stringify({ voice: 'https://proj.supabase.co/storage/v1/object/public/photos/__ME__/v1.webm' })]); const r = await as('e', `select public.my_matches() r`); if (!r.r[0].other.voice) throw new Error('voice not public'); });

console.log(`\n${ok} passed, ${bad} failed`);
