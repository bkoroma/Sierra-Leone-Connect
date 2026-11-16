import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const core = fs.readFileSync((ROOT + '/supabase/schema.sql'), 'utf8').split('-- ═══ SUPABASE-PLATFORM SECTION')[0].replace('create extension if not exists pgcrypto;', '');
const mig = '';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz default now(), last_sign_in_at timestamptz, created_at timestamptz not null default now());
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create schema storage; create table storage.buckets (id text primary key); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
insert into storage.buckets values ('photos'), ('voice'), ('verifications');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid(), auth.jwt() to authenticated, anon; grant usage on schema public to authenticated, anon;`);
await db.exec(core); await db.exec(mig);
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '—', e.message); } };
const err = async (n, f, re) => t(n, async () => { try { await f(); } catch (e) { if (re.test(e.message)) return; throw e; } throw new Error('expected error'); });
const signup = (email, meta) => db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)]);
let id;
await t('signup with metadata fills profile', async () => {
  id = (await signup('a@x.com', { first_name: ' Aminata ', last_name: 'Kamara', username: 'Aminata_K', gender: 'woman', dob: '1996-04-27', country: 'Sierra Leone', city: 'Bo', lat: 7.96432, lng: -11.7391 })).rows[0].id;
  const p = (await db.query(`select name, last_name, username, gender, prefs, dob::text, country, city, lat, lng from public.profiles where id = $1`, [id])).rows[0];
  if (p.gender !== 'woman' || JSON.stringify(p.prefs.seeking) !== '["man"]' || p.name !== 'Aminata' || p.last_name !== 'Kamara' || p.username !== 'aminata_k' || p.country !== 'Sierra Leone' || p.city !== 'Bo' || p.lat !== 7.96) throw new Error(JSON.stringify(p));
});
await err('duplicate username (any case) rejected', () => signup('b@x.com', { first_name: 'B', username: 'AMINATA_K', dob: '1990-01-01' }), /taken/);
await err('underage rejected at sign-up', () => signup('c@x.com', { first_name: 'C', username: 'kid_c', dob: '2012-01-01' }), /18\+/);
await err('bad username rejected', () => signup('d@x.com', { first_name: 'D', username: '.bad..name', dob: '1990-01-01' }), /taken or invalid/);
await t('signup without metadata still works (legacy/admin-created)', async () => { await signup('e@x.com', {}); });
await t('invalid gender value ignored (stays empty)', async () => { const r = await signup('g@x.com', { username: 'gg_test', gender: 'robot', dob: '1990-01-01' }); const g = (await db.query('select gender from public.profiles where id = $1', [r.rows[0].id])).rows[0].gender; if (g !== null) throw new Error(g); });
await t('username_available: taken / free / invalid', async () => {
  const q = async u => (await db.query(`select public.username_available($1) r`, [u])).rows[0].r;
  if ((await q('Aminata_K')) !== false || (await q('fatmata.k')) !== true || (await q('ab')) !== false || (await q('a__b')) !== false) throw new Error('wrong');
});
await t('anon can call username_available', async () => { await db.exec('set role anon'); try { await db.query(`select public.username_available('zz_top')`); } finally { await db.exec('reset role'); } });
await t('_pub exposes only the username (no first/last name anywhere); _full has both names', async () => {
  const r = (await db.query(`select public._pub(p) pub, public._full(p) f from public.profiles p where id = $1`, [id])).rows[0];
  if (r.pub.username !== 'aminata_k' || r.pub.name !== 'aminata_k' || 'lastName' in r.pub || 'firstName' in r.pub || JSON.stringify(r.pub).includes('Aminata') || r.f.name !== 'Aminata' || r.f.lastName !== 'Kamara') throw new Error(JSON.stringify([r.pub.name, r.f.name, r.f.lastName]));
});
console.log(`${ok} passed, ${bad} failed`);
