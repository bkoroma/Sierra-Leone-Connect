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


// ───────── slc_15: health & operations ─────────
await t('anon can execute only get_settings, username_available, log_client_error', async () => {
  const r = (await db.query(`select array_agg(p.proname order by p.proname) a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].a;
  assert(JSON.stringify(r) === '["get_settings","log_client_error","username_available"]', JSON.stringify(r));
});
await t('client errors are grouped (numbers/ids normalised) and counted', async () => {
  await db.exec(`set role anon`);
  try {
    await db.query(`select public.log_client_error('index', 'TypeError: x is undefined at line 12', 'stack1', 'UA', '1.5.0')`);
    await db.query(`select public.log_client_error('index', 'TypeError: x is undefined at line 99', '', 'UA', '1.5.0')`);
    await db.query(`select public.log_client_error('admin', 'Other error', '', 'UA', '1.5.0')`);
    await db.query(`select public.log_client_error('index', '   ', '', 'UA', '1.5.0')`);
  } finally { await db.exec('reset role'); }
  const r = (await db.query(`select page, count, stack from public.client_errors order by page`)).rows;
  assert(r.length === 2 && r.find(x => x.page === 'index').count === 2 && r.find(x => x.page === 'index').stack === 'stack1', JSON.stringify(r));
});
await t('client error table is capped at 500 rows', async () => {
  await db.query(`insert into public.client_errors (sig, message) select 'fill' || g, 'm' from generate_series(1, 600) g on conflict do nothing`);
  const before = (await db.query(`select count(*)::int n from public.client_errors`)).rows[0].n;
  await db.query(`select public.log_client_error('x', 'brand new error')`);
  const after = (await db.query(`select count(*)::int n from public.client_errors`)).rows[0].n; assert(after === before, `${before} -> ${after}`);
  await db.query(`delete from public.client_errors where sig like 'fill%'`);
});
await expectErr('members cannot read health', () => as('m1', `select public.super_health()`), /Not authorized/);
await expectErr('admins cannot read health', () => as('adm', `select public.super_health()`), /Not authorized/);
await t('super_health shape: tables, storage, auth, staff 2FA, backlog, errors', async () => {
  await db.query(`update auth.users set email_confirmed_at = null where email = 'm3@x.com'`);
  await db.query(`insert into auth.mfa_factors (user_id, status) select id, 'verified' from auth.users where email in ('sup@x.com')`);
  await db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('photos', 'a/1.jpg', $1, '{"size": 1000}'), ('photos', 'a/2.jpg', $1, '{"size": 500}')`, [ids.m1]);
  await as('m2', `select public.report_user($1, 'Other', 'x')`, [ids.m1]);
  const h = (await as('sup', `select public.super_health() r`)).r;
  assert(h.schema === 17 && h.tables.profiles === 7 && h.tables.client_errors === 2, 'tables ' + JSON.stringify(h.tables));
  const ph = h.storage.find(b => b.bucket === 'photos'); assert(ph.files === 2 && Number(ph.bytes) === 1500, JSON.stringify(h.storage));
  assert(h.auth.users === 7 && h.auth.unconfirmed7d === 1, JSON.stringify(h.auth));
  assert(h.staff.superadmins === 2 && h.staff.without2fa.length === 3 && !h.staff.without2fa.includes('sup@x.com'), JSON.stringify(h.staff));
  assert(h.backlog.openReports === 1 && h.backlog.oldestReport, JSON.stringify(h.backlog));
  assert(h.errors.last24h === 3 && h.errors.recent.length === 2, JSON.stringify(h.errors).slice(0, 200));
  assert(h.members.total === 3 && 'stuckOnboarding' in h.members, JSON.stringify(h.members));
});
await t('super clears errors (audited)', async () => {
  await as('sup', `select public.super_clear_errors()`);
  assert((await db.query(`select count(*)::int n from public.client_errors`)).rows[0].n === 0, 'not cleared');
  assert((await db.query(`select count(*)::int n from public.audit_log where action = 'clear_errors'`)).rows[0].n === 1, 'audit');
});
await t('support / safety e-mails saved via settings and readable by anyone', async () => {
  await as('sup', `select public.super_save_settings('{"supportEmail":"Help@SLConnect.org","safetyEmail":"safety@slconnect.org"}'::jsonb)`);
  await db.exec('set role anon'); let s; try { s = (await db.query(`select public.get_settings() r`)).rows[0].r; } finally { await db.exec('reset role'); }
  assert(s.supportEmail === 'help@slconnect.org' && s.safetyEmail === 'safety@slconnect.org' && s.dailyLikes === 50, JSON.stringify(s));
  await as('sup', `select public.super_save_settings('{"dailyLikes": 40}'::jsonb)`);
  s = (await as('m1', `select public.get_settings() r`)).r; assert(s.supportEmail === 'help@slconnect.org' && s.dailyLikes === 40, 'kept');
  await as('sup', `select public.super_save_settings('{"supportEmail": ""}'::jsonb)`);
  s = (await as('m1', `select public.get_settings() r`)).r; assert(!('supportEmail' in s), 'clear');
});
await expectErr('bad support e-mail rejected', () => as('sup', `select public.super_save_settings('{"supportEmail":"not-an-email"}'::jsonb)`), /doesn't look right/);
await t('two SuperAdmins: one may delete their own account', async () => { await as('sup2', `select public.delete_account()`); assert(!(await get(ids.sup2)), 'not deleted'); });
await expectErr('the last SuperAdmin cannot delete their own account', () => as('sup', `select public.delete_account()`), /only SuperAdmin/);
await t('admin notes + e-mail actions logged and shown in member history', async () => {
  await as('adm', `select public.admin_note($1, 'Called the member, will watch.')`, [ids.m1]);
  await as('adm', `select public.admin_note($1, '', 'send_reset')`, [ids.m1]);
  const d = (await as('adm', `select public.admin_member($1) r`, [ids.m1])).r;
  assert(d.history.some(x => x.action === 'note' && x.meta.note === 'Called the member, will watch.') && d.history.some(x => x.action === 'send_reset'), 'history');
  assert(d.emailConfirmed === true && 'lastSignIn' in d, 'confirmed field');
});
await expectErr('empty note rejected', () => as('adm', `select public.admin_note($1, ' ')`, [ids.m1]), /Write the note/);
await expectErr('admin cannot note on staff', () => as('adm', `select public.admin_note($1, 'x')`, [ids.sup]), /SuperAdmin/);
await t('members filters: unconfirmed + onboarding', async () => {
  const u = (await as('adm', `select public.admin_members('', 'unconfirmed') r`)).r; assert(u.length === 1 && u[0].email === 'm3@x.com' && u[0].emailConfirmed === false, JSON.stringify(u.map(x => x.email)));
  const o = (await as('adm', `select public.admin_members('', 'onboarding') r`)).r; assert(o.length === 2, 'onboarding ' + o.length);
});
await t('verification queue has requestedAt, oldest first', async () => {
  await db.query(`update public.profiles set verification_status = 'pending', verification_requested_at = now() - interval '2 days' where id = $1`, [ids.m2]);
  await db.query(`update public.profiles set verification_status = 'pending', verification_requested_at = now() - interval '1 hour' where id = $1`, [ids.m3]);
  const v = (await as('adm', `select public.admin_verifications() r`)).r; assert(v.length === 2 && v[0].id === ids.m2 && v[0].requestedAt, JSON.stringify(v.map(x => x.id)));
  const h = (await as('sup', `select public.super_health() r`)).r; assert(new Date(h.backlog.oldestVerification) < Date.now() - 1.9 * 864e5, 'oldest');
});
await t('request_verification stamps the time', async () => {
  await as('m1', `select public.request_verification($1)`, ['verifications/' + ids.m1 + '/s.jpg']);
  assert((await get(ids.m1)).verification_requested_at, 'no stamp');
});
await t('all foreign keys have a covering index', async () => {
  const r = (await db.query(`select c.conrelid::regclass::text t, c.conname from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey)`)).rows;
  assert(r.length === 0, JSON.stringify(r));
});
await t('maintenance mode blocks members on the server but not staff', async () => {
  await as('sup', `select public.super_save_settings('{"maintenance": true}'::jsonb)`);
  try { await as('m2', `select public.get_me()`); throw new Error('member allowed'); } catch (e) { assert(/maintenance/.test(e.message), e.message); }
  await as('adm', `select public.admin_stats()`);
  await as('sup', `select public.super_save_settings('{"maintenance": false}'::jsonb)`);
  await as('m2', `select public.get_me()`);
});
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
