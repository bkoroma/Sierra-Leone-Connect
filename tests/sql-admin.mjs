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

// Access control
await expectErr('member cannot call admin_members', () => as('m1', `select public.admin_members('', 'all')`), /Not authorized/);
await expectErr('admin without 2FA blocked', () => as('adm', `select public.admin_members('', 'all')`, [], 'aal1'), /aal2/);
await expectErr('admin cannot delete accounts', () => as('adm', `select public.super_delete_user($1)`, [ids.m3]), /Not authorized/);
await expectErr('admin cannot list a member’s media', () => as('adm', `select public.admin_user_media($1)`, [ids.m3]), /Not authorized/);
await t('anon can execute only get_settings + username_available', async () => {
  const r = (await db.query(`select array_agg(p.proname order by p.proname) a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].a;
  assert(JSON.stringify(r) === '["get_settings","log_client_error","username_available"]', JSON.stringify(r));
});
await t('authenticated can execute the new staff RPCs but not internal helpers', async () => {
  const can = async f => (await db.query(`select has_function_privilege('authenticated', $1, 'execute') x`, [f])).rows[0].x;
  for (const f of ['public.admin_member(uuid)', 'public.admin_members(text,text)', 'public.ack_notice()', 'public.super_delete_user(uuid)']) assert(await can(f), f);
  for (const f of ['public._eligible(public.profiles,public.profiles)', 'public._admin_row(public.profiles)', 'public._admin_target(public.profiles,uuid)']) assert(!(await can(f)), f);
});

// Members search + filters
await t('admin_members search + filters', async () => {
  const all = (await as('adm', `select public.admin_members('', 'all') r`)).r; assert(all.length === 7, 'all ' + all.length);
  const staff = (await as('adm', `select public.admin_members('', 'staff') r`)).r; assert(staff.length === 4, 'staff ' + staff.length);
  const q = (await as('adm', `select public.admin_members('user_m2', 'all') r`)).r; assert(q.length === 1 && q[0].profile.firstName === 'Fm2', 'search');
  const row = all.find(x => x.id === ids.m1); assert('openReports' in row && 'lastActive' in row && row.profile.lastName === null, 'row shape');
});
await expectErr('bad filter rejected', () => as('adm', `select public.admin_members('', 'hackers')`), /Bad filter/);

// Timed suspension
await t('suspend 3 days → member blocked with end date', async () => {
  await as('adm', `select public.admin_moderate($1, 'suspended', 'Spam', 3)`, [ids.m1]);
  const p = await get(ids.m1); assert(p.status === 'suspended' && p.suspended_until > new Date(Date.now() + 2.9 * 864e5), 'until');
  try { await as('m1', `select public.get_me()`); throw new Error('not blocked'); } catch (e) { assert(/suspended until .*Spam/.test(e.message), e.message); }
  const s = (await as('m1', `select public.my_session() r`)).r; assert(s.status === 'suspended' && s.suspendedUntil, 'session');
});
await t('expired suspension lifts itself on next open', async () => {
  await db.query(`update public.profiles set suspended_until = now() - interval '1 minute' where id = $1`, [ids.m1]);
  const s = (await as('m1', `select public.my_session() r`)).r; assert(s.status === 'active', 'session ' + s.status);
  await as('m1', `select public.get_me()`);
  const p = await get(ids.m1); assert(p.status === 'active' && p.suspended_until === null && p.status_reason === null, JSON.stringify([p.status, p.suspended_until]));
});
await expectErr('suspension length validated', () => as('adm', `select public.admin_moderate($1, 'suspended', 'x', 999)`, [ids.m1]), /1–365/);
await expectErr('admin cannot suspend staff', () => as('adm', `select public.admin_moderate($1, 'suspended', 'x', 1)`, [ids.adm2]), /SuperAdmin/);
await expectErr('nobody can change own status', () => as('sup', `select public.admin_moderate($1, 'banned', 'x')`, [ids.sup]), /own status/);
await t('indefinite suspension + reinstate clears reason', async () => {
  await as('adm', `select public.admin_moderate($1, 'suspended', 'Investigating')`, [ids.m3]);
  let p = await get(ids.m3); assert(p.status === 'suspended' && p.suspended_until === null, 'indef');
  await as('adm', `select public.admin_moderate($1, 'active')`, [ids.m3]);
  p = await get(ids.m3); assert(p.status === 'active' && p.status_reason === null, 'reinstate');
});
await t('legacy admin_set_status still works', async () => { await as('adm', `select public.admin_set_status($1, 'active', '')`, [ids.m3]); });

// Warnings
await t('warning delivered to member and acknowledged', async () => {
  await as('adm', `select public.admin_warn($1, 'Please keep it respectful.')`, [ids.m2]);
  const me = (await as('m2', `select public.get_me() r`)).r; assert(me.notice === 'Please keep it respectful.' && me.noticeAt, 'notice ' + me.notice);
  await as('m2', `select public.ack_notice()`);
  const me2 = (await as('m2', `select public.get_me() r`)).r; assert(me2.notice === null, 'acked');
});
await expectErr('empty warning rejected', () => as('adm', `select public.admin_warn($1, '  ')`, [ids.m2]), /Write the warning/);

// Reports
const mkReport = async (by, target, reason) => { await as(by, `select public.report_user($1, $2, 'details here')`, [ids[target], reason]); return (await db.query(`select id from public.reports where target = $1 and status = 'open' order by created_at desc limit 1`, [ids[target]])).rows[0].id; };
await t('report → warn sends the default notice', async () => {
  const r = await mkReport('m2', 'm1', 'Harassment or hate');
  await as('adm', `select public.admin_handle_report($1, 'warn', '')`, [r]);
  const p = await get(ids.m1); assert(/Harassment or hate/.test(p.notice), p.notice);
  const rr = (await db.query(`select status, resolution from public.reports where id = $1`, [r])).rows[0]; assert(rr.status === 'actioned' && rr.resolution === 'warn', 'status');
});
await t('report → suspend uses chosen days', async () => {
  const r = await mkReport('m2', 'm1', 'Spam or advertising');
  await as('adm', `select public.admin_handle_report($1, 'suspend', '', 14)`, [r]);
  const p = await get(ids.m1); assert(p.status === 'suspended' && p.suspended_until > new Date(Date.now() + 13.9 * 864e5), 'days');
  await as('adm', `select public.admin_moderate($1, 'active')`, [ids.m1]);
});
await expectErr('report cannot be handled twice', async () => {
  const r = await mkReport('m2', 'm1', 'Other');
  await as('adm', `select public.admin_handle_report($1, 'dismiss', '')`, [r]);
  await as('adm2', `select public.admin_handle_report($1, 'ban', '')`, [r]);
}, /already been handled/);
await t('ban closes the member’s other open reports', async () => {
  const r1 = await mkReport('m2', 'm3', 'Fake profile or photos'); await mkReport('m1', 'm3', 'Asking for money / scam');
  await as('adm', `select public.admin_handle_report($1, 'ban', '')`, [r1]);
  const open = (await db.query(`select count(*)::int n from public.reports where target = $1 and status = 'open'`, [ids.m3])).rows[0].n; assert(open === 0, 'open ' + open);
  assert((await get(ids.m3)).status === 'banned', 'banned');
});

// Member detail + content edits
await t('admin_member returns profile, counts, reports, history', async () => {
  const d = (await as('adm', `select public.admin_member($1) r`, [ids.m1])).r;
  assert(d.firstName === 'Fm1' && d.email === 'm1@x.com' && d.counts && d.counts.reportsAgainst === 3, 'counts ' + JSON.stringify(d.counts));
  assert(d.reports.length === 3 && d.reports[0].reporter === 'user_m2', 'reports');
  assert(d.history.some(h => h.action === 'suspend') && d.history.some(h => h.action === 'warn'), 'history ' + d.history.map(h => h.action));
});
await t('remove 2nd photo, clear bio/prompts/voice', async () => {
  const r = (await as('adm', `select public.admin_edit_member($1, 'remove_photo', 1) r`, [ids.m1])).r; assert(r.removed === 'https://a.co/2.jpg', 'removed ' + r.removed);
  let p = await get(ids.m1); assert(JSON.stringify(p.photos) === '["https://a.co/1.jpg","https://a.co/3.jpg"]', JSON.stringify(p.photos));
  await as('adm', `select public.admin_edit_member($1, 'remove_photo', 0)`, [ids.m1]); p = await get(ids.m1); assert(JSON.stringify(p.photos) === '["https://a.co/3.jpg"]', 'first');
  await as('adm', `select public.admin_edit_member($1, 'clear_bio')`, [ids.m1]);
  await as('adm', `select public.admin_edit_member($1, 'clear_prompts')`, [ids.m1]);
  const v = (await as('adm', `select public.admin_edit_member($1, 'clear_voice') r`, [ids.m1])).r; assert(v.removed === 'https://a.co/v.webm', 'voice');
  p = await get(ids.m1); assert(p.bio === null && JSON.stringify(p.prompts) === '[]' && p.voice_url === null, 'cleared');
});
await expectErr('remove photo out of range', () => as('adm', `select public.admin_edit_member($1, 'remove_photo', 5)`, [ids.m1]), /Photo not found/);
await t('revoke verification', async () => {
  await db.query(`update public.profiles set verified = true, verification_status = 'approved' where id = $1`, [ids.m2]);
  await as('adm', `select public.admin_edit_member($1, 'revoke_verification')`, [ids.m2]);
  const p = await get(ids.m2); assert(!p.verified && p.verification_status === 'none', 'revoked');
});
await expectErr('decide verification only when pending', () => as('adm', `select public.admin_decide_verification($1, true)`, [ids.m2]), /already decided/);
await t('approve pending verification', async () => {
  await db.query(`update public.profiles set verification_status = 'pending' where id = $1`, [ids.m2]);
  await as('adm', `select public.admin_decide_verification($1, true)`, [ids.m2]);
  assert((await get(ids.m2)).verified, 'verified');
});

// Settings
await t('pause sign-ups blocks new accounts; reopen allows', async () => {
  await as('sup', `select public.super_save_settings('{"signupsOpen": false}'::jsonb)`);
  try { await db.query(`insert into auth.users (email, raw_user_meta_data) values ('late@x.com', '{"username":"late_one"}')`); throw new Error('allowed'); } catch (e) { assert(/paused/.test(e.message), e.message); }
  const s = (await as('m2', `select public.get_settings() r`)).r; assert(s.signupsOpen === false && s.dailyLikes === 50, 'settings kept ' + JSON.stringify(s));
  await as('sup', `select public.super_save_settings('{"signupsOpen": true}'::jsonb)`);
  await db.query(`insert into auth.users (email, raw_user_meta_data) values ('late@x.com', '{"username":"late_one"}')`);
});
await expectErr('admin cannot change settings', () => as('adm', `select public.super_save_settings('{"maintenance": true}'::jsonb)`), /Not authorized/);

// Stats + analytics
await t('admin_stats + super_analytics shapes', async () => {
  const s = (await as('adm', `select public.admin_stats() r`)).r; assert(s.banned === 1 && 'suspended' in s && 'new7d' in s, JSON.stringify(s));
  const a = (await as('sup', `select public.super_analytics() r`)).r; assert(a.likes.length === 14 && a.byGender.man >= 1 && a.totals.members >= 3, JSON.stringify(a.totals));
});

// SuperAdmin delete
await expectErr('super cannot delete self', () => as('sup', `select public.super_delete_user($1)`, [ids.sup]), /own account/);
await expectErr('super cannot delete another superadmin', () => as('sup', `select public.super_delete_user($1)`, [ids.sup2]), /SuperAdmin role/);
await t('super deletes a member account (cascade; audit keeps no e-mail)', async () => {
  await as('sup', `select public.super_delete_user($1)`, [ids.m3]);
  assert(!(await get(ids.m3)), 'profile gone');
  assert((await db.query(`select count(*)::int n from auth.users where id = $1`, [ids.m3])).rows[0].n === 0, 'auth gone');
  const a = (await db.query(`select meta from public.audit_log where action = 'delete_user'`)).rows[0]; assert(!a.meta.email && 'wasBanned' in a.meta && a.meta.emailHash, 'audit ' + JSON.stringify(a.meta));
});
await t('super audit log lists the new actions', async () => {
  const rows = (await as('sup', `select public.super_audit() r`)).r; const acts = new Set(rows.map(r => r.action));
  for (const x of ['suspend', 'reinstate', 'warn', 'ban', 'edit_member', 'resolve_report', 'delete_user', 'save_settings']) assert(acts.has(x), 'missing ' + x);
});
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
