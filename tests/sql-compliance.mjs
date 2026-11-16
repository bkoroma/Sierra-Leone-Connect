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


// ───────── slc_16: compliance ─────────
await t('sign-up stores consent records from metadata', async () => {
  const id = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('c1@x.com', '{"username":"consent_one","terms_version":"2026-11-11","sensitive_consent":true}') returning id`)).rows[0].id;
  const p = await get(id); assert(p.terms_version === '2026-11-11' && p.terms_accepted_at && p.sensitive_consent_at, JSON.stringify([p.terms_version, p.sensitive_consent_at]));
  ids.c1 = id;
});
await t('older sign-ups without consent have empty records, and get_me exposes them', async () => {
  const me = (await as('m1', `select public.get_me() r`)).r; assert(me.termsVersion === null && me.sensitiveConsentAt === null, JSON.stringify([me.termsVersion]));
});
await expectErr('accept_terms requires the sensitive-data consent', () => as('m1', `select public.accept_terms('2026-11-11', false)`), /needs this consent/);
await t('accept_terms records version + time (audited)', async () => {
  await as('m1', `select public.accept_terms('2026-11-11', true)`);
  const me = (await as('m1', `select public.get_me() r`)).r; assert(me.termsVersion === '2026-11-11' && me.termsAcceptedAt && me.sensitiveConsentAt, 'not stored');
  assert((await db.query(`select count(*)::int n from public.audit_log where action = 'accept_terms'`)).rows[0].n === 1, 'audit');
});
await t('export_my_data includes my data and nothing private about others', async () => {
  await db.query(`update public.profiles set onboarded = true, faith = 'Muslim', bio = 'my bio' where id in ($1, $2)`, [ids.m1, ids.m2]);
  await as('m1', `select public.swipe($1, 'like', 'hi there')`, [ids.m2]);
  await as('m2', `select public.swipe($1, 'like')`, [ids.m1]);
  const mid = (await db.query(`select id from public.matches limit 1`)).rows[0].id;
  await as('m1', `select public.send_message($1, 'Hello from m1')`, [mid]);
  await as('m2', `select public.send_message($1, 'Secret reply from m2')`, [mid]);
  await as('m1', `select public.report_user($1, 'Other', 'test')`, [ids.m2]);
  const x = (await as('m1', `select public.export_my_data() r`)).r;
  assert(x.account.email === 'm1@x.com' && x.profile.faith === 'Muslim' && x.profile.firstName === 'Fm1', 'profile');
  assert(x.likesAndPassesISent.length === 1 && x.likesAndPassesISent[0].to === 'user_m2' && x.likesAndPassesISent[0].comment === 'hi there', 'likes');
  assert(x.matches.length === 1 && x.messagesISent.length === 2 && x.messagesISent.some(m => m.text === 'Hello from m1') && x.messagesISent.some(m => m.text === 'hi there'), 'messages');
  assert(!JSON.stringify(x).includes('Secret reply') && !JSON.stringify(x).includes('m2@x.com') && !JSON.stringify(x).includes('Fm2'), 'leaks other member');
  assert(x.reportsIMade.length === 1 && x.likesReceivedCount === 1 && x.account.termsVersion === '2026-11-11', 'reports/consent');
});
await expectErr('anon cannot export', async () => { await db.exec('set role anon'); try { await db.query(`select public.export_my_data()`); } finally { await db.exec('reset role'); } }, /permission denied/);
await t('verification decision deletes the selfie reference', async () => {
  await as('m2', `select public.request_verification($1)`, ['verifications/' + ids.m2 + '/s.jpg']);
  await as('adm', `select public.admin_decide_verification($1, true)`, [ids.m2]);
  const p = await get(ids.m2); assert(p.verified && p.verification_selfie === null, 'selfie kept');
});
await t('error reports older than 30 days are purged', async () => {
  await db.query(`insert into public.client_errors (sig, message, last_at) values ('old1', 'old', now() - interval '31 days')`);
  await db.query(`select public.log_client_error('x', 'a brand new error')`);
  assert((await db.query(`select count(*)::int n from public.client_errors where sig = 'old1'`)).rows[0].n === 0, 'old kept');
});
await t('super delete of a banned member: audit has no e-mail/username; e-mail blocked from re-registering', async () => {
  await as('adm', `select public.admin_moderate($1, 'banned', 'scam')`, [ids.m3]);
  await as('sup', `select public.super_delete_user($1)`, [ids.m3]);
  const a = (await db.query(`select meta from public.audit_log where action = 'delete_user'`)).rows[0].meta;
  assert(!JSON.stringify(a).includes('m3@x.com') && !JSON.stringify(a).includes('user_m3') && a.wasBanned === true, JSON.stringify(a));
  try { await db.query(`insert into auth.users (email, raw_user_meta_data) values ('M3@x.com', '{"username":"back_again"}')`); throw new Error('re-registered'); }
  catch (e) { assert(/can't be used/.test(e.message), e.message); }
  assert(!(await db.query(`select 1 from public.banned_emails where hash like '%m3%'`)).rows.length, 'plain email stored');
});
await t('a banned member can still delete their own account (right to erasure)', async () => {
  await as('adm', `select public.admin_moderate($1, 'banned', 'x')`, [ids.c1]);
  await as('c1', `select public.delete_account()`);
  assert(!(await get(ids.c1)), 'not deleted');
  const a = (await db.query(`select actor, meta from public.audit_log where action = 'account_deleted' and target = $1`, [ids.c1])).rows[0];
  assert(a.actor === null && JSON.stringify(a.meta) === '{}', JSON.stringify(a));
  try { await db.query(`insert into auth.users (email) values ('c1@x.com')`); throw new Error('re-registered'); } catch (e) { assert(/can't be used/.test(e.message), e.message); }
});
await t('non-banned self-deletion leaves no e-mail hash (can rejoin)', async () => {
  await as('m1', `select public.delete_account()`);
  await db.query(`insert into auth.users (email, raw_user_meta_data) values ('m1@x.com', '{"username":"m1_again"}')`);
});
await t('operator details saved; HTML rejected', async () => {
  await as('sup', `select public.super_save_settings('{"operatorName":"Koroma Digital LLC","operatorAddress":"123 Main St, MD 20784","operatorCountry":"United States"}'::jsonb)`);
  const s = (await as('m2', `select public.get_settings() r`)).r; assert(s.operatorName === 'Koroma Digital LLC' && s.operatorCountry === 'United States', JSON.stringify(s));
  try { await as('sup', `select public.super_save_settings('{"operatorName":"<script>"}'::jsonb)`); throw new Error('allowed'); } catch (e) { assert(/can't contain/.test(e.message), e.message); }
});
await t('health reports schema 16 and missing consents', async () => {
  const h = (await as('sup', `select public.super_health() r`)).r; assert(h.schema === 17 && h.consent.missing >= 1 && h.consent.bannedEmailHashes === 2, JSON.stringify(h.consent));
});
await t('anon still limited to 3 functions', async () => {
  const r = (await db.query(`select array_agg(p.proname order by p.proname) a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].a;
  assert(JSON.stringify(r) === '["get_settings","log_client_error","username_available"]', JSON.stringify(r));
});
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
