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
create schema storage; create table storage.buckets (id text primary key); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
create function storage.foldername(n text) returns text[] language sql immutable as $f$ select (string_to_array(n, '/'))[1:array_length(string_to_array(n, '/'), 1) - 1] $f$;
insert into storage.buckets values ('photos'), ('voice'), ('verifications');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
grant usage on schema public to authenticated, anon;
`);
await db.exec(core);
{ const mig = fs.readFileSync((ROOT + '/supabase/migrations/slc_17_audit_fixes.sql'), 'utf8'); const part = mig.split('-- ─────────── Account deletion ───────────')[1].split('create or replace function public._schema_version()')[0]; await db.exec(part); await db.exec(`grant execute on function public.my_media() to authenticated; grant usage on schema storage to authenticated;`).catch(() => {}); }
const ids = {};
for (const k of ['m1', 'm2', 'm3', 'adm', 'adm2', 'sup', 'sup2']) ids[k] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [k + '@x.com', JSON.stringify({ username: 'user_' + k, first_name: 'F' + k, dob: '1994-02-02', gender: k === 'm2' ? 'woman' : 'man' })])).rows[0].id;
await db.exec(`update public.profiles set role='admin' where email in ('adm@x.com','adm2@x.com'); update public.profiles set role='superadmin' where email in ('sup@x.com','sup2@x.com');
  update public.profiles set onboarded = true, photos = '{https://a.co/1.jpg,https://a.co/2.jpg,https://a.co/3.jpg}', bio = 'Spammy bio here', prompts = '[{"q":"a","a":"b"}]', voice_url = 'https://a.co/v.webm' where email = 'm1@x.com';`);
let ok = 0, bad = 0;
async function as(who, sql, params = [], aal = 'aal2') {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ids[who]}', false), set_config('request.jwt.claims', '{"aal":"${aal}"}', false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows[0]; } finally { await db.exec('reset role'); }
}
const t = async (name, fn) => { try { await fn(); ok++; console.log('✓', name); } catch (e) { bad++; console.log('✗', name, '—', e.message); } };
const expectErr = async (name, fn, re) => t(name, async () => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw e; } throw new Error('expected error'); });
const get = async (id) => (await db.query(`select * from public.profiles where id = $1`, [id])).rows[0];
const assert = (c, m) => { if (!c) throw new Error(m); };


const asIss = async (who, sql, params = [], iss = 'https://proj.supabase.co/auth/v1') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ids[who]}', false), set_config('request.jwt.claims', '${JSON.stringify({ aal: 'aal1', iss })}', false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows[0]; } finally { await db.exec('reset role'); }
};
const P = (who, f = 'a1.jpg', host = 'proj.supabase.co') => `https://${host}/storage/v1/object/public/photos/${ids[who]}/${f}`;
await db.exec(`update public.profiles set onboarded = true, intent = 'serious', terms_version = 'x', terms_accepted_at = now(), sensitive_consent_at = now() where role = 'user'`);

// ───────── slc_17: audit fixes ─────────
await t('photos: own storage file accepted', async () => { await asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ photos: [P('m1'), P('m1', 'b2.webp')] })]); assert((await get(ids.m1)).photos.length === 2, 'not saved'); });
await expectErr('photos: another server refused', () => asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ photos: [P('m1', 'a1.jpg', 'evil.supabase.co')] })]), /Invalid photo/);
await expectErr('photos: outside link refused', () => asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ photos: ['https://tracker.example.com/pixel.jpg'] })]), /Invalid photo/);
await expectErr('photos: another member’s folder refused', () => asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ photos: [P('m2')] })]), /Invalid photo/);
await expectErr('photos: path tricks refused', () => asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ photos: [P('m1', '../' + ids.m2 + '/a.jpg')] })]), /Invalid photo/);
await t('voice intro: own file accepted, outside refused, null clears', async () => {
  await asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ voice: P('m1', 'v1.webm') })]);
  try { await asIss('m1', `select public.save_profile($1::jsonb)`, [JSON.stringify({ voice: 'https://x.example.com/a.webm' })]); throw new Error('allowed'); } catch (e) { assert(/Invalid voice/.test(e.message), e.message); }
  await asIss('m1', `select public.save_profile('{"voice": null}'::jsonb)`); assert((await get(ids.m1)).voice_url === null, 'not cleared');
});
await t('photos: without a token issuer the generic pattern still applies', async () => { await as('m2', `select public.save_profile($1::jsonb)`, [JSON.stringify({ photos: [P('m2', 'z9.png', 'abc.supabase.co')] })]); });

await t('reserved usernames refused (and at sign-up)', async () => {
  for (const u of ['admin', 'Admin_Team', 'support', 'sl.connect', 'slconnect_help', 'moderator1', 'official.amy', 'staff', 'sierra_leone_connect'])
    assert((await db.query(`select public.username_available($1) r`, [u])).rows[0].r === false, u + ' allowed');
  for (const u of ['aminata_k', 'stafford', 'modupe', 'teamwork', 'helpful.joe'])
    assert((await db.query(`select public.username_available($1) r`, [u])).rows[0].r === true, u + ' refused');
  try { await db.query(`insert into auth.users (email, raw_user_meta_data) values ('imp@x.com', '{"username":"support_team"}')`); throw new Error('created'); } catch (e) { assert(/taken or invalid/.test(e.message), e.message); }
});

let mid;
await t('unmatch: other person cannot force the match back', async () => {
  await as('m1', `select public.swipe($1, 'like')`, [ids.m2]); await as('m2', `select public.swipe($1, 'like')`, [ids.m1]);
  mid = (await db.query(`select id from public.matches`)).rows[0].id;
  await as('m1', `select public.send_message($1, 'hello')`, [mid]);
  await as('m2', `select public.unmatch($1)`, [mid]);
  const r = (await as('m1', `select public.swipe($1, 'like') r`, [ids.m2])).r; assert(r.match === null, 'rematched: ' + JSON.stringify(r));
  assert((await db.query(`select unmatched_at from public.matches where id = $1`, [mid])).rows[0].unmatched_at, 'match revived');
});
await expectErr('unmatched conversation can no longer be read', () => as('m1', `select public.get_messages($1)`, [mid]), /not found/);
await expectErr('unmatched conversation cannot be messaged', () => as('m1', `select public.send_message($1, 'again')`, [mid]), /only message your matches/);
await t('the person who unmatched can choose to match again later', async () => {
  const r = (await as('m2', `select public.swipe($1, 'like') r`, [ids.m1])).r; assert(r.match && r.match.id === mid, 'no rematch');
  await as('m1', `select public.get_messages($1)`, [mid]);
});
await t('block: conversation unreadable, my like removed', async () => {
  await as('m2', `select public.block_user($1)`, [ids.m1]);
  try { await as('m1', `select public.get_messages($1)`, [mid]); throw new Error('readable'); } catch (e) { assert(/not found/.test(e.message), e.message); }
  assert((await db.query(`select count(*)::int n from public.swipes where swiper = $1 and target = $2 and kind <> 'pass'`, [ids.m2, ids.m1])).rows[0].n === 0, 'like kept');
});
await expectErr('block: missing member gives a clean error', () => as('m2', `select public.block_user(gen_random_uuid())`), /no longer available/);
await t('_is_member: banned member loses direct chat access', async () => {
  await as('m3', `select public.swipe($1, 'like')`, [ids.m2]).catch(() => {});
  await db.query(`insert into public.matches (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)) on conflict do nothing`, [ids.m3, ids.adm]);
  const m3 = (await db.query(`select id from public.matches where $1 in (user_a, user_b) and $2 in (user_a, user_b)`, [ids.m3, ids.adm])).rows[0].id;
  assert((await as('m3', `select public._is_member($1) r`, [m3])).r === true, 'active not member');
  await db.query(`update public.profiles set status = 'banned' where id = $1`, [ids.m3]);
  assert((await as('m3', `select public._is_member($1) r`, [m3])).r === false, 'banned still member');
  await db.query(`update public.profiles set status = 'suspended', suspended_until = now() - interval '1 hour' where id = $1`, [ids.m3]);
  assert((await as('m3', `select public._is_member($1) r`, [m3])).r === true, 'expired suspension blocked');
  await db.query(`update public.profiles set status = 'active', suspended_until = null where id = $1`, [ids.m3]);
});
await t('reports: repeat report updates the open one', async () => {
  await as('m3', `select public.report_user($1, 'Spam or advertising', 'first')`, [ids.m2]);
  await as('m3', `select public.report_user($1, 'Harassment or hate', 'second, more detail')`, [ids.m2]);
  const r = (await db.query(`select reason, details from public.reports where reporter = $1 and target = $2`, [ids.m3, ids.m2])).rows;
  assert(r.length === 1 && r[0].reason === 'Harassment or hate' && r[0].details === 'second, more detail', JSON.stringify(r));
  const rid = (await db.query(`select id from public.reports where reporter = $1 and target = $2`, [ids.m3, ids.m2])).rows[0].id;
  await as('adm', `select public.admin_handle_report($1, 'dismiss', '')`, [rid]);
  await as('m3', `select public.report_user($1, 'Other', 'new issue')`, [ids.m2]);
  assert((await db.query(`select count(*)::int n from public.reports where reporter = $1 and target = $2`, [ids.m3, ids.m2])).rows[0].n === 2, 'no new report after handling');
});
await expectErr('reports: empty reason refused', () => as('m3', `select public.report_user($1, '  ')`, [ids.m2]), /Choose a reason/);
await expectErr('reports: missing member gives a clean error', () => as('m3', `select public.report_user(gen_random_uuid(), 'Other')`), /no longer available/);

// account deletion media
await db.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('photos', $1, $2, null), ('photos', $3, null, $4), ('photos', $5, null, null), ('voice', 'somematch/v.webm', null, $4), ('photos', $6, $7, null)`,
  [ids.m3 + '/a.jpg', ids.m3, ids.m3 + '/b.jpg', ids.m3, ids.m3 + '/c.jpg', ids.m2 + '/x.jpg', ids.m2]);
await t('my_media lists own files via owner, owner_id or folder — and works when banned', async () => {
  await db.query(`update public.profiles set status = 'banned' where id = $1`, [ids.m3]);
  const r = (await as('m3', `select public.my_media() r`)).r; assert(r.length === 4 && r.every(f => !f.path.startsWith(ids.m2)), JSON.stringify(r));
  await db.query(`update public.profiles set status = 'active' where id = $1`, [ids.m3]);
});
await expectErr('my_media refuses the last SuperAdmin before any file is touched', async () => { await db.query(`update public.profiles set role = 'user' where id = $1`, [ids.sup2]); await as('sup', `select public.my_media()`); }, /only SuperAdmin/);
await expectErr('admin_user_media refuses SuperAdmin targets', async () => { await db.query(`update public.profiles set role = 'superadmin' where id = $1`, [ids.sup2]); await as('sup', `select public.admin_user_media($1)`, [ids.sup2]); }, /Remove the SuperAdmin role/);
await expectErr('admin_user_media refuses self', () => as('sup', `select public.admin_user_media($1)`, [ids.sup]), /own account/);
await t('admin_user_media lists a member’s files', async () => { const r = (await as('sup', `select public.admin_user_media($1) r`, [ids.m3])).r; assert(r.length === 4, JSON.stringify(r)); });
await t('helpers are not callable by members; schema is 17', async () => {
  const can = async f => (await db.query(`select has_function_privilege('authenticated', $1, 'execute') x`, [f])).rows[0].x;
  assert(!(await can('public._own_media(text,uuid,text)')) && !(await can('public._reserved_username(text)')), 'helper exposed');
  assert((await db.query(`select public._schema_version() v`)).rows[0].v === 17, 'version');
});
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
