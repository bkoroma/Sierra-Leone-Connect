-- ════════════════════════════════════════════════════════════════════════════
-- Sierra Leone Connect — Supabase schema (run once in the SQL editor)
-- Design: clients never read or write tables directly. Every operation goes
-- through SECURITY DEFINER RPCs that enforce auth, status, blocks, quotas and
-- roles. RLS is ON for every table with no permissive policies, except a
-- SELECT policy on messages so Realtime can deliver chat to match members.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────────────────────── Tables ───────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text check (char_length(name) <= 30),
  dob date,
  gender text check (gender in ('woman','man')),
  intent text check (intent in ('marriage','serious','open','friends')),
  city text, country text,
  lat double precision, lng double precision,
  home_district text, heritage text, faith text,
  languages text[] not null default '{}',
  interests text[] not null default '{}',
  prompts jsonb not null default '[]',
  photos text[] not null default '{}',
  bio text check (char_length(bio) <= 400),
  job text, education text, height_cm int check (height_cm between 120 and 230),
  prefs jsonb not null default '{}',
  paused boolean not null default false,
  onboarded boolean not null default false,
  completeness int not null default 0,
  verified boolean not null default false,
  verification_status text not null default 'none' check (verification_status in ('none','pending','approved','rejected')),
  verification_selfie text,
  role text not null default 'user' check (role in ('user','admin','superadmin')),
  status text not null default 'active' check (status in ('active','suspended','banned')),
  status_reason text,
  streak int not null default 0, streak_day date,
  voice_url text check (voice_url ~ '^https://'),
  qotd_day date,
  last_active timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists profiles_discover_idx on public.profiles (status, onboarded, paused, gender);
create index if not exists profiles_active_idx on public.profiles (last_active desc);

create table if not exists public.swipes (
  swiper uuid not null references public.profiles(id) on delete cascade,
  target uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('like','pass','super')),
  comment text not null default '' check (char_length(comment) <= 200),
  ref text not null default '' check (char_length(ref) <= 160),
  created_at timestamptz not null default now(),
  primary key (swiper, target)
);
create index if not exists swipes_target_idx on public.swipes (target, kind);
create index if not exists swipes_day_idx on public.swipes (swiper, created_at);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unmatched_at timestamptz,
  read_a timestamptz, read_b timestamptz,
  expires_at timestamptz default now() + interval '7 days',
  extended boolean not null default false,
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  kind text not null default 'text' check (kind in ('text','voice','game','game_ans')),
  media text, meta jsonb, ctx text,
  flagged text[] not null default '{}',
  cleared boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_match_idx on public.messages (match_id, created_at);
create index if not exists messages_flag_idx on public.messages (created_at) where array_length(flagged,1) > 0 and not cleared;

create table if not exists public.blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references public.profiles(id) on delete set null,
  target uuid references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null, details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  resolution text, handled_by uuid references public.profiles(id) on delete set null, handled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Compatibility questions: catalog (ids + option counts mirror js/constants.js) and answers
create table if not exists public.questions (id text primary key, n_opts int not null check (n_opts between 2 and 8));
create table if not exists public.answers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  qid text not null references public.questions(id) on delete cascade,
  m int not null, a int[] not null, i int not null check (i between 0 and 4),
  updated_at timestamptz not null default now(),
  primary key (user_id, qid)
);
create table if not exists public.tot_pairs (a text not null, b text not null, primary key (a, b));
insert into public.questions (id, n_opts) values
  ('faith_role', 4),
  ('interfaith', 3),
  ('worship_together', 3),
  ('honesty', 3),
  ('ambition', 3),
  ('polygamy', 3),
  ('kids_want', 5),
  ('kids_count', 4),
  ('family_say', 3),
  ('extended_family', 3),
  ('put_stone', 3),
  ('provider', 3),
  ('chores', 4),
  ('move_home', 5),
  ('relocate', 3),
  ('long_distance', 3),
  ('visit_home', 4),
  ('kids_language', 3),
  ('culture', 3),
  ('alcohol', 3),
  ('smoke', 3),
  ('weekend', 4),
  ('money', 3),
  ('job_stable', 3),
  ('fitness', 3),
  ('night_owl', 3),
  ('marry_when', 4),
  ('texting', 4),
  ('love_lang', 5),
  ('conflict', 3),
  ('opp_friends', 3),
  ('first_date_pay', 3),
  ('social_media', 3),
  ('phone_check', 3)
on conflict (id) do update set n_opts = excluded.n_opts;
insert into public.tot_pairs (a, b) values
  ('Jollof rice', 'Cassava leaf'),
  ('Lumley Beach', 'Tokeh Beach'),
  ('Afrobeats', 'Gospel'),
  ('Freetown', 'Bo'),
  ('Poda-poda', 'Okada'),
  ('Groundnut soup', 'Okra soup'),
  ('Beach day', 'Family lunch'),
  ('Text', 'Voice note'),
  ('Early morning', 'Late night'),
  ('Fry fish', 'Roast meat'),
  ('Ginger beer', 'Bissap'),
  ('Big wedding', 'Small wedding'),
  ('Movie night', 'Dancing'),
  ('Rice every day', 'Something new'),
  ('Plan everything', 'Go with the flow'),
  ('Cook together', 'Eat out'),
  ('Mountains', 'Sea'),
  ('Football', 'Music'),
  ('Save', 'Spend'),
  ('Krio', 'English')
on conflict do nothing;

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null
);
insert into public.app_settings (id, data) values (1, '{"dailyLikes":50,"dailySuperLikes":3,"scamShield":true,"minAge":18,"maintenance":false,"announcement":"","requireAdminMfa":true,"undoEnabled":true}')
on conflict (id) do nothing;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid, action text not null, target text, meta jsonb not null default '{}',
  at timestamptz not null default now()
);

-- Lock everything down; access is via RPCs only.
alter table public.profiles enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.tot_pairs enable row level security;
revoke all on public.profiles, public.swipes, public.matches, public.messages, public.blocks, public.reports, public.app_settings, public.audit_log, public.questions, public.answers, public.tot_pairs from anon, authenticated;

-- Realtime chat: members of a match may SELECT its messages (nothing else).
grant select on public.messages to authenticated;
drop policy if exists messages_members_read on public.messages;
create or replace function public._is_member(p_match uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.matches m where m.id = p_match and m.unmatched_at is null and auth.uid() in (m.user_a, m.user_b)) $$;
create policy messages_members_read on public.messages for select to authenticated using (public._is_member(match_id));

-- ─────────────────────────── Auth hook ───────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email)) on conflict (id) do nothing;
  insert into public.audit_log (actor, action, target) values (new.id, 'signup', new.id::text);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ─────────────────────────── Helpers ───────────────────────────
create or replace function public._settings() returns jsonb language sql stable security definer set search_path = public as
$$ select data from public.app_settings where id = 1 $$;

create or replace function public._me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Please log in again.'; end if;
  if p.status = 'banned' then raise exception 'This account has been banned.'; end if;
  if p.status = 'suspended' then raise exception 'This account is suspended. %', coalesce(p.status_reason, ''); end if;
  return p;
end $$;

create or replace function public._staff(p_level text default 'admin') returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles := public._me();
begin
  if p_level = 'superadmin' and p.role <> 'superadmin' then raise exception 'Not authorized.'; end if;
  if p.role not in ('admin','superadmin') then raise exception 'Not authorized.'; end if;
  if coalesce((public._settings()->>'requireAdminMfa')::boolean, true)
     and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'Two-factor authentication required (aal2).';
  end if;
  return p;
end $$;

create or replace function public._audit(p_actor uuid, p_action text, p_target text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as
$$ insert into public.audit_log (actor, action, target, meta) values (p_actor, p_action, p_target, coalesce(p_meta,'{}')) $$;

create or replace function public._age(d date) returns int language sql immutable set search_path = public as
$$ select extract(year from age(current_date, d))::int $$;

create or replace function public._km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = public as $$
  select case when a_lat is null or b_lat is null then null else
    2 * 6371 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))) end
$$;

create or replace function public._blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a)) $$;

-- Public card: no email, selfie, role or exact coordinates (rounded to ~1 km).
create or replace function public._pub(p public.profiles) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'dob', p.dob, 'gender', p.gender, 'intent', p.intent,
    'city', p.city, 'country', p.country, 'lat', round(p.lat::numeric, 2), 'lng', round(p.lng::numeric, 2),
    'homeDistrict', p.home_district, 'heritage', p.heritage, 'faith', p.faith,
    'languages', to_jsonb(p.languages), 'interests', to_jsonb(p.interests), 'prompts', p.prompts,
    'photos', to_jsonb(p.photos), 'bio', p.bio, 'job', p.job, 'education', p.education, 'heightCm', p.height_cm,
    'verified', p.verified, 'lastActive', p.last_active, 'completeness', p.completeness, 'voice', p.voice_url, 'createdAt', p.created_at, 'prefs',
    jsonb_build_object('seeking', coalesce(p.prefs->'seeking','[]'), 'ageMin', p.prefs->'ageMin', 'ageMax', p.prefs->'ageMax'))
$$;

create or replace function public._full(p public.profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select public._pub(p) || jsonb_build_object('lat', p.lat, 'lng', p.lng, 'prefs', p.prefs, 'paused', p.paused, 'onboarded', p.onboarded,
    'verificationStatus', p.verification_status, 'streak', p.streak, 'createdAt', p.created_at, 'email', p.email,
    'answers', coalesce((select jsonb_object_agg(qid, jsonb_build_object('m', m, 'a', to_jsonb(a), 'i', i)) from public.answers where user_id = p.id), '{}'),
    'answersCount', (select count(*) from public.answers where user_id = p.id))
$$;

-- OkCupid-style match (mirrors qMatch in js/match.js): weights 0/1/10/50/250, geometric mean of
-- both sides' satisfaction minus 1/n margin; any unmet "Dealbreaker" sets deal = true.
create or replace function public._qmatch(p_a uuid, p_b uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w int[] := array[0,1,10,50,250]; pa numeric := 0; ea numeric := 0; pb numeric := 0; eb numeric := 0; n int := 0; deal boolean := false; agree jsonb; r record;
begin
  for r in select x.qid, x.m xm, x.a xa, x.i xi, y.m ym, y.a ya, y.i yi from public.answers x join public.answers y on y.qid = x.qid and y.user_id = p_b where x.user_id = p_a loop
    n := n + 1;
    pa := pa + w[r.xi + 1]; pb := pb + w[r.yi + 1];
    if r.ym = any(r.xa) then ea := ea + w[r.xi + 1]; elsif r.xi = 4 then deal := true; end if;
    if r.xm = any(r.ya) then eb := eb + w[r.yi + 1]; elsif r.yi = 4 then deal := true; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', qid, 'ans', xm) order by wt desc, qid), '[]') into agree from (
    select x.qid, x.m xm, w[x.i + 1] + w[y.i + 1] wt from public.answers x join public.answers y on y.qid = x.qid and y.user_id = p_b
    where x.user_id = p_a and x.m = y.m) z;
  if n < 3 then return jsonb_build_object('pct', null, 'n', n, 'agree', agree, 'deal', deal); end if;
  return jsonb_build_object('n', n, 'agree', agree, 'deal', deal,
    'pct', round(100 * greatest(0, sqrt((case when pa = 0 then 1 else ea / pa end) * (case when pb = 0 then 1 else eb / pb end)) - 1.0 / n)));
end $$;

create or replace function public._recalc(p_id uuid) returns void language sql security definer set search_path = public as $$
  update public.profiles me set completeness = (
    (select count(*) from unnest(array[
      me.name is not null, me.dob is not null, me.gender is not null, me.intent is not null, me.city is not null,
      me.home_district is not null, me.heritage is not null, me.faith is not null, coalesce(char_length(me.bio),0) >= 30,
      cardinality(me.photos) >= 1, cardinality(me.photos) >= 3, cardinality(me.interests) >= 3, cardinality(me.languages) >= 1,
      (select count(*) from jsonb_array_elements(me.prompts) e where coalesce(e->>'a','') <> '') >= 2, me.job is not null, me.education is not null,
      (select count(*) from public.answers where user_id = me.id) >= 10, me.voice_url is not null]) b where b) * 100 / 18)
  where me.id = p_id
$$;

create or replace function public._seeks(a public.profiles, b public.profiles) returns boolean language sql stable set search_path = public as $$
  select (jsonb_array_length(coalesce(a.prefs->'seeking','[]')) = 0 or (a.prefs->'seeking') ? b.gender)
     and public._age(b.dob) between coalesce((a.prefs->>'ageMin')::int, 18) and coalesce((a.prefs->>'ageMax')::int, 99)
$$;

-- Scam Shield (mirrors js/util.js scamCheck)
create or replace function public._scam(t text) returns text[] language plpgsql immutable set search_path = public as $$
declare r text[] := '{}';
begin
  if t ~* '\m(send|wire|transfer|lend|loan|borrow)\M.{0,25}(money|cash|funds|\$|£|€|usd|leones?)' then r := array_append(r, 'money request'); end if;
  if t ~* '(western\s*union|money\s*gram|orange\s*money|afri\s*money|cash\s*app|zelle|venmo|paypal|remitly|world\s*remit|taptap\s*send|lemfi)' then r := array_append(r, 'payment service'); end if;
  if t ~* '\m(gift\s*cards?|itunes\s*card|steam\s*card|amazon\s*card)\M' then r := array_append(r, 'gift cards'); end if;
  if t ~* '\m(bitcoin|btc|usdt|crypto|binance|forex|investment\s*plan|double\s*your)\M' then r := array_append(r, 'crypto / investment'); end if;
  if t ~* '\m(transport|visa|ticket|hospital|school)\s*(fee|money|fare)\M' then r := array_append(r, 'fee request'); end if;
  if t ~* '\m(whats\s*app|telegram|signal|snap(chat)?|hangouts?)\M' then r := array_append(r, 'off-platform contact'); end if;
  if t ~ '\+?\d[\d\s().-]{8,}\d' then r := array_append(r, 'phone number'); end if;
  if t ~* '(https?://|www\.)\S+' then r := array_append(r, 'external link'); end if;
  return r;
end $$;

-- ─────────────────────────── Member RPCs ───────────────────────────
create or replace function public.get_settings() returns jsonb language sql stable security definer set search_path = public as
$$ select public._settings() $$;

create or replace function public.my_session() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'email', email, 'role', role, 'status', status, 'statusReason', status_reason)
  from public.profiles where id = auth.uid()
$$;

create or replace function public.get_me() returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles := public._me();
begin
  update public.profiles set last_active = now() where id = p.id returning * into p;
  return public._full(p);
end $$;

create or replace function public.save_profile(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); min_age int := coalesce((public._settings()->>'minAge')::int, 18);
begin
  if p ? 'dob' and p->>'dob' is not null and public._age((p->>'dob')::date) < min_age then
    raise exception 'You must be %+ to use Sierra Leone Connect.', min_age;
  end if;
  if p ? 'photos' and exists (select 1 from jsonb_array_elements_text(p->'photos') u where u !~ '^https://') then
    raise exception 'Invalid photo URL.';
  end if;
  if p ? 'voice' and p->>'voice' is not null and p->>'voice' !~ '^https://' then raise exception 'Invalid voice URL.'; end if;
  update public.profiles set
    name = case when p ? 'name' then left(trim(p->>'name'), 30) else name end,
    dob = case when p ? 'dob' then (p->>'dob')::date else dob end,
    gender = case when p ? 'gender' then p->>'gender' else gender end,
    intent = case when p ? 'intent' then p->>'intent' else intent end,
    city = case when p ? 'city' then left(p->>'city', 60) else city end,
    country = case when p ? 'country' then left(p->>'country', 60) else country end,
    lat = case when p ? 'lat' then round((p->>'lat')::numeric, 2)::double precision else lat end,
    lng = case when p ? 'lng' then round((p->>'lng')::numeric, 2)::double precision else lng end,
    home_district = case when p ? 'homeDistrict' then left(p->>'homeDistrict', 60) else home_district end,
    heritage = case when p ? 'heritage' then left(p->>'heritage', 40) else heritage end,
    faith = case when p ? 'faith' then left(p->>'faith', 40) else faith end,
    languages = case when p ? 'languages' then (select coalesce(array_agg(left(x, 30)), '{}') from (select jsonb_array_elements_text(p->'languages') x limit 10) s) else languages end,
    interests = case when p ? 'interests' then (select coalesce(array_agg(left(x, 40)), '{}') from (select jsonb_array_elements_text(p->'interests') x limit 10) s) else interests end,
    prompts = case when p ? 'prompts' then (select coalesce(jsonb_agg(jsonb_build_object('q', left(e->>'q', 120), 'a', left(coalesce(e->>'a',''), 160))), '[]') from (select jsonb_array_elements(p->'prompts') e limit 3) s) else prompts end,
    photos = case when p ? 'photos' then (select coalesce(array_agg(x), '{}') from (select jsonb_array_elements_text(p->'photos') x limit 6) s) else photos end,
    bio = case when p ? 'bio' then left(p->>'bio', 400) else bio end,
    job = case when p ? 'job' then left(p->>'job', 50) else job end,
    education = case when p ? 'education' then left(p->>'education', 60) else education end,
    height_cm = case when p ? 'heightCm' then nullif((p->>'heightCm'),'')::int else height_cm end,
    prefs = case when p ? 'prefs' then jsonb_build_object(
      'seeking', coalesce(p->'prefs'->'seeking', '[]'),
      'ageMin', greatest(18, least(99, coalesce((p->'prefs'->>'ageMin')::int, 18))),
      'ageMax', greatest(18, least(99, coalesce((p->'prefs'->>'ageMax')::int, 99))),
      'maxKm', greatest(1, least(20000, coalesce((p->'prefs'->>'maxKm')::int, 100))),
      'mode', coalesce(p->'prefs'->>'mode', 'worldwide'),
      'faithMatters', coalesce((p->'prefs'->>'faithMatters')::boolean, false),
      'sameIntentOnly', coalesce((p->'prefs'->>'sameIntentOnly')::boolean, false)) else prefs end,
    paused = case when p ? 'paused' then (p->>'paused')::boolean else paused end,
    onboarded = case when p ? 'onboarded' then onboarded or (p->>'onboarded')::boolean else onboarded end,
    voice_url = case when p ? 'voice' then p->>'voice' else voice_url end,
    last_active = now()
  where id = me.id returning * into me;
  perform public._recalc(me.id); -- profile strength (same checklist as js/match.js completeness)
  select * into me from public.profiles where id = me.id;
  return public._full(me);
end $$;

create or replace function public.save_answer(p_qid text, p_m int, p_a int[], p_i int, p_qotd boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); nq int; acc int[];
begin
  select n_opts into nq from public.questions where id = p_qid;
  if nq is null then raise exception 'Unknown question.'; end if;
  if p_m is null or p_m < 0 or p_m >= nq or p_i is null or p_i < 0 or p_i > 4 then raise exception 'Invalid answer.'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into acc from unnest(p_a) x where x >= 0 and x < nq;
  if cardinality(acc) = 0 then raise exception 'Pick at least one answer you would accept.'; end if;
  insert into public.answers (user_id, qid, m, a, i) values (me.id, p_qid, p_m, acc, p_i)
    on conflict (user_id, qid) do update set m = excluded.m, a = excluded.a, i = excluded.i, updated_at = now();
  if p_qotd then update public.profiles set qotd_day = current_date where id = me.id; end if;
  perform public._recalc(me.id);
  return jsonb_build_object('answersCount', (select count(*) from public.answers where user_id = me.id));
end $$;

create or replace function public.remove_answer(p_qid text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  delete from public.answers where user_id = me.id and qid = p_qid;
  perform public._recalc(me.id);
end $$;

create or replace function public._supers_allowed(p public.profiles) returns int language sql stable security definer set search_path = public as
$$ select (public._settings()->>'dailySuperLikes')::int + case when p.qotd_day = current_date then 1 else 0 end $$;

create or replace function public.request_verification(p_selfie text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if p_selfie !~ ('^verifications/' || me.id::text || '/') then raise exception 'Invalid selfie path.'; end if;
  update public.profiles set verification_selfie = p_selfie, verification_status = 'pending' where id = me.id;
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.quota() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._me(); s jsonb := public._settings();
begin
  return jsonb_build_object(
    'likesLeft', greatest(0, (s->>'dailyLikes')::int - (select count(*) from public.swipes where swiper = me.id and kind = 'like' and created_at >= date_trunc('day', now()))),
    'supersLeft', greatest(0, public._supers_allowed(me) - (select count(*) from public.swipes where swiper = me.id and kind = 'super' and created_at >= date_trunc('day', now()))),
    'qotdDone', me.qotd_day is not distinct from current_date);
end $$;

create or replace function public.get_deck(p_mode text default 'worldwide') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); res jsonb;
begin
  with base as (
    select p as prof, p.id, p.last_active, public._qmatch(me.id, p.id) as qm from public.profiles p
    where p.id <> me.id and p.status = 'active' and p.onboarded and not p.paused and p.role = 'user'
      and public._age(p.dob) >= 18
      and not exists (select 1 from public.swipes s where s.swiper = me.id and s.target = p.id)
      and not public._blocked(me.id, p.id)
      and public._seeks(me, p) and public._seeks(p, me)
      and (not coalesce((me.prefs->>'faithMatters')::boolean, false) or p.faith is null or me.faith is null or p.faith = me.faith or p.faith = 'Prefer not to say')
      and (not coalesce((me.prefs->>'sameIntentOnly')::boolean, false) or p.intent = me.intent)
      and (p_mode <> 'salone' or p.country = 'Sierra Leone')
      and (p_mode <> 'diaspora' or p.country is distinct from 'Sierra Leone')
      and (p_mode <> 'near' or coalesce(public._km(me.lat, me.lng, p.lat, p.lng) <= coalesce((me.prefs->>'maxKm')::int, 100), p.country = me.country))
  ), c as (
    select * from base where not coalesce((qm->>'deal')::boolean, false) order by last_active desc limit 300
  )
  select jsonb_build_object(
    'candidates', coalesce((select jsonb_agg(public._pub(c.prof) || jsonb_build_object('q', c.qm)) from c), '[]'),
    'likedMe', coalesce((select jsonb_agg(c.id) from c where exists (select 1 from public.swipes s where s.swiper = c.id and s.target = me.id and s.kind <> 'pass')), '[]'))
  into res;
  return res;
end $$;

create or replace function public.swipe(p_target uuid, p_kind text, p_comment text default '', p_ref text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); t public.profiles; s jsonb := public._settings(); m public.matches; a uuid; b uuid;
  cmt text := case when p_kind = 'pass' then '' else left(trim(coalesce(p_comment, '')), 200) end; theirs public.swipes; fresh boolean := false;
begin
  if p_kind not in ('like','pass','super') then raise exception 'Bad swipe.'; end if;
  if cmt <> '' and public._scam(cmt) && array['phone number','external link','off-platform contact','payment service','money request'] then
    raise exception 'Keep contact details and money talk out of likes — say something about their profile instead 😊';
  end if;
  select * into t from public.profiles where id = p_target and status = 'active' and onboarded;
  if t.id is null or t.id = me.id then raise exception 'This profile is no longer available.'; end if;
  if public._blocked(me.id, t.id) then raise exception 'This profile is no longer available.'; end if;
  perform pg_advisory_xact_lock(hashtext(me.id::text));
  if p_kind = 'like' and (select count(*) from public.swipes where swiper = me.id and kind = 'like' and created_at >= date_trunc('day', now())) >= (s->>'dailyLikes')::int then
    raise exception 'You''ve used today''s likes. They refresh at midnight ✨';
  end if;
  if p_kind = 'super' and (select count(*) from public.swipes where swiper = me.id and kind = 'super' and created_at >= date_trunc('day', now())) >= public._supers_allowed(me) then
    raise exception 'No Oya! likes left today.';
  end if;
  insert into public.swipes (swiper, target, kind, comment, ref) values (me.id, t.id, p_kind, cmt, case when cmt = '' and p_ref = '' then '' else left(coalesce(p_ref, ''), 160) end)
    on conflict (swiper, target) do update set kind = excluded.kind, comment = excluded.comment, ref = excluded.ref, created_at = now();
  select * into theirs from public.swipes where swiper = t.id and target = me.id and kind <> 'pass';
  if p_kind <> 'pass' and theirs.swiper is not null then
    a := least(me.id, t.id); b := greatest(me.id, t.id);
    select * into m from public.matches where user_a = a and user_b = b;
    if m.id is null then
      insert into public.matches (user_a, user_b) values (a, b) on conflict (user_a, user_b) do nothing returning * into m;
      fresh := m.id is not null;
      if not fresh then select * into m from public.matches where user_a = a and user_b = b; end if;
    elsif m.unmatched_at is not null then
      update public.matches set unmatched_at = null, expires_at = now() + interval '7 days' where id = m.id returning * into m;
    end if;
    if fresh then -- Hinge-style: comments sent with likes open the conversation
      if theirs.comment <> '' then insert into public.messages (match_id, sender, body, ctx, flagged, created_at) values (m.id, t.id, theirs.comment, nullif('Liked ' || theirs.ref, 'Liked '), public._scam(theirs.comment), now() - interval '1 millisecond'); end if;
      if cmt <> '' then insert into public.messages (match_id, sender, body, ctx, flagged) values (m.id, me.id, cmt, nullif('Liked ' || left(coalesce(p_ref, ''), 160), 'Liked '), public._scam(cmt)); end if;
      if theirs.comment <> '' or cmt <> '' then update public.matches set expires_at = null where id = m.id; end if;
    end if;
    return jsonb_build_object('match', jsonb_build_object('id', m.id, 'other', public._pub(t) || jsonb_build_object('q', public._qmatch(me.id, t.id))));
  end if;
  return jsonb_build_object('match', null);
end $$;

create or replace function public.undo_swipe() returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); sw public.swipes; t public.profiles;
begin
  if not coalesce((public._settings()->>'undoEnabled')::boolean, true) then raise exception 'Undo is turned off.'; end if;
  select * into sw from public.swipes where swiper = me.id order by created_at desc limit 1;
  if sw.swiper is null then raise exception 'Nothing to undo.'; end if;
  if exists (select 1 from public.matches where user_a = least(me.id, sw.target) and user_b = greatest(me.id, sw.target) and unmatched_at is null) then
    raise exception 'You already matched — say hi instead 😊';
  end if;
  delete from public.swipes where swiper = me.id and target = sw.target;
  select * into t from public.profiles where id = sw.target;
  return public._pub(t) || jsonb_build_object('q', public._qmatch(me.id, t.id));
end $$;

create or replace function public.likes_you() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  return coalesce((select jsonb_agg(public._pub(p) || jsonb_build_object('superLiked', s.kind = 'super', 'comment', s.comment, 'ref', s.ref, 'q', public._qmatch(me.id, p.id)) order by s.kind = 'super' desc, s.comment <> '' desc, s.created_at desc)
    from public.swipes s join public.profiles p on p.id = s.swiper
    where s.target = me.id and s.kind <> 'pass' and p.status = 'active' and not p.paused
      and not exists (select 1 from public.swipes x where x.swiper = me.id and x.target = p.id)
      and not public._blocked(me.id, p.id)
      and not coalesce((public._qmatch(me.id, p.id)->>'deal')::boolean, false)), '[]');
end $$;

create or replace function public.my_matches() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  return coalesce((select jsonb_agg(row order by coalesce(row->'last'->>'at', row->>'at') desc) from (
    select jsonb_build_object('id', m.id, 'at', m.created_at, 'other', public._pub(o) || jsonb_build_object('q', public._qmatch(me.id, o.id)),
      'expiresAt', m.expires_at, 'extended', m.extended,
      'last', (select jsonb_build_object('id', x.id, 'from', x.sender, 'body', x.body, 'kind', x.kind, 'at', x.created_at, 'flagged', to_jsonb(x.flagged)) from public.messages x where x.match_id = m.id order by x.created_at desc limit 1),
      'unread', (select count(*) from public.messages x where x.match_id = m.id and x.sender <> me.id and x.created_at > coalesce(case when m.user_a = me.id then m.read_a else m.read_b end, 'epoch'))) as row
    from public.matches m join public.profiles o on o.id = case when m.user_a = me.id then m.user_b else m.user_a end
    where m.unmatched_at is null and me.id in (m.user_a, m.user_b) and o.status <> 'banned' and not public._blocked(me.id, o.id)
      and (m.expires_at is null or m.expires_at > now() or exists (select 1 from public.messages x where x.match_id = m.id))) q), '[]');
end $$;

create or replace function public._msg(x public.messages) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', x.id, 'matchId', x.match_id, 'from', x.sender, 'body', x.body, 'kind', x.kind, 'media', x.media,
    'meta', x.meta, 'ctx', x.ctx, 'at', x.created_at, 'flagged', to_jsonb(x.flagged))
$$;

create or replace function public.get_messages(p_match uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); m public.matches;
begin
  select * into m from public.matches where id = p_match and me.id in (user_a, user_b);
  if m.id is null then raise exception 'Conversation not found.'; end if;
  if m.user_a = me.id then update public.matches set read_a = now() where id = m.id; else update public.matches set read_b = now() where id = m.id; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public._msg(x) order by x.created_at)
      from (select * from public.messages where match_id = m.id order by created_at desc limit 500) x), '[]'),
    'otherReadAt', case when m.user_a = me.id then m.read_b else m.read_a end);
end $$;

create or replace function public.extend_match(p_match uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); m public.matches;
begin
  select * into m from public.matches where id = p_match and unmatched_at is null and me.id in (user_a, user_b) for update;
  if m.id is null then raise exception 'Match not found.'; end if;
  if m.extended then raise exception 'You can only extend a match once.'; end if;
  update public.matches set expires_at = greatest(coalesce(expires_at, now()), now()) + interval '3 days', extended = true where id = m.id returning * into m;
  return jsonb_build_object('expiresAt', m.expires_at);
end $$;

create or replace function public.send_message(p_match uuid, p_body text, p_kind text default 'text', p_media text default null, p_meta jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); m public.matches; other uuid; msg public.messages; body text := left(trim(coalesce(p_body,'')), 1000);
  v_meta jsonb := null; v_media text := null; g public.messages;
begin
  select * into m from public.matches where id = p_match and unmatched_at is null and me.id in (user_a, user_b);
  if m.id is null then raise exception 'You can only message your matches.'; end if;
  if p_kind = 'voice' then
    if p_media is null or p_media !~ ('^' || m.id::text || '/[A-Za-z0-9-]+\.(webm|m4a|mp4|ogg)$') then raise exception 'Invalid voice note.'; end if;
    v_media := p_media; body := '🎤 Voice note';
  elsif p_kind = 'game' then
    if not exists (select 1 from public.tot_pairs where a = p_meta->>'a' and b = p_meta->>'b') then raise exception 'Bad game.'; end if;
    v_meta := jsonb_build_object('a', p_meta->>'a', 'b', p_meta->>'b'); body := '🎲 This or That: ' || (p_meta->>'a') || ' or ' || (p_meta->>'b') || '?';
  elsif p_kind = 'game_ans' then
    select * into g from public.messages where id = (p_meta->>'ref')::uuid and match_id = m.id and kind = 'game';
    if g.id is null or (p_meta->>'pick') not in ('0','1') then raise exception 'Bad answer.'; end if;
    if exists (select 1 from public.messages where public.messages.kind = 'game_ans' and sender = me.id and public.messages.meta->>'ref' = g.id::text) then raise exception 'You already answered.'; end if;
    v_meta := jsonb_build_object('ref', g.id, 'pick', (p_meta->>'pick')::int); body := '🎲 Picked an answer';
  elsif p_kind <> 'text' then raise exception 'Bad message type.';
  end if;
  if body = '' then raise exception 'Message is empty.'; end if;
  other := case when m.user_a = me.id then m.user_b else m.user_a end;
  if public._blocked(me.id, other) then raise exception 'You can''t message this person.'; end if;
  if (select count(*) from public.messages where sender = me.id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down a little — try again in a minute.';
  end if;
  insert into public.messages (match_id, sender, body, kind, media, meta, flagged)
    values (m.id, me.id, body, p_kind, v_media, v_meta, case when p_kind = 'text' and coalesce((public._settings()->>'scamShield')::boolean, true) then public._scam(body) else '{}' end)
    returning * into msg;
  update public.matches set expires_at = null where id = m.id and expires_at is not null;
  update public.profiles set last_active = now() where id = me.id;
  return public._msg(msg);
end $$;

create or replace function public.unmatch(p_match uuid) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  update public.matches set unmatched_at = now() where id = p_match and me.id in (user_a, user_b);
end $$;

create or replace function public.report_user(p_target uuid, p_reason text, p_details text default '', p_message uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if p_target = me.id then raise exception 'You cannot report yourself.'; end if;
  if (select count(*) from public.reports where reporter = me.id and created_at > now() - interval '1 day') >= 20 then raise exception 'Report limit reached for today.'; end if;
  insert into public.reports (reporter, target, reason, details, message_id)
  values (me.id, p_target, left(p_reason, 80), left(coalesce(p_details,''), 1000),
          (select id from public.messages x where x.id = p_message and x.sender = p_target));
end $$;

create or replace function public.block_user(p_target uuid) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if p_target = me.id then return; end if;
  insert into public.blocks (blocker, blocked) values (me.id, p_target) on conflict do nothing;
  update public.matches set unmatched_at = now() where user_a = least(me.id, p_target) and user_b = greatest(me.id, p_target);
end $$;

create or replace function public.touch_streak() returns int language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if me.streak_day is distinct from current_date then
    update public.profiles set streak = case when streak_day = current_date - 1 then streak + 1 else 1 end, streak_day = current_date
    where id = me.id returning * into me;
  end if;
  return me.streak;
end $$;

create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$
declare me public.profiles := public._me();
begin
  insert into public.audit_log (actor, action, target) values (me.id, 'account_deleted', me.id::text);
  delete from auth.users where id = me.id; -- cascades to profile, swipes, matches, messages
end $$;

-- ─────────────────────────── Staff RPCs ───────────────────────────
create or replace function public.admin_stats() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  return jsonb_build_object(
    'users', (select count(*) from public.profiles where role = 'user'),
    'active24h', (select count(*) from public.profiles where role = 'user' and last_active > now() - interval '1 day'),
    'newToday', (select count(*) from public.profiles where role = 'user' and created_at > now() - interval '1 day'),
    'matches', (select count(*) from public.matches where unmatched_at is null),
    'messages', (select count(*) from public.messages),
    'openReports', (select count(*) from public.reports where status = 'open'),
    'pendingVerifications', (select count(*) from public.profiles where verification_status = 'pending'),
    'flagged', (select count(*) from public.messages where array_length(flagged,1) > 0 and not cleared),
    'banned', (select count(*) from public.profiles where status = 'banned'));
end $$;

create or replace function public.admin_users(p_q text default '') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff(); q text := '%' || lower(coalesce(trim(p_q),'')) || '%';
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason, 'createdAt', p.created_at, 'profile', public._pub(p)) order by p.created_at desc)
    from (select * from public.profiles where lower(coalesce(email,'')) like q or lower(coalesce(name,'')) like q or lower(coalesce(city,'')) like q order by created_at desc limit 200) p), '[]');
end $$;

create or replace function public.admin_set_status(p_id uuid, p_status text, p_reason text default '') returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles;
begin
  if p_status not in ('active','suspended','banned') then raise exception 'Bad status'; end if;
  if p_id = me.id then raise exception 'You cannot change your own status.'; end if;
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role <> 'user' and me.role <> 'superadmin' then raise exception 'Only a SuperAdmin can act on staff accounts.'; end if;
  update public.profiles set status = p_status, status_reason = left(p_reason, 200) where id = p_id;
  perform public._audit(me.id, 'set_status', p_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

create or replace function public.admin_reports(p_status text default 'open') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'resolution', r.resolution, 'at', r.created_at,
      'reporter', jsonb_build_object('id', rp.id, 'email', rp.email, 'name', rp.name),
      'subject', public._pub(t) || jsonb_build_object('email', t.email, 'status', t.status),
      'message', (select x.body from public.messages x where x.id = r.message_id)) order by r.created_at desc)
    from (select * from public.reports where p_status = 'all' or status = p_status order by created_at desc limit 200) r
    left join public.profiles rp on rp.id = r.reporter join public.profiles t on t.id = r.target), '[]');
end $$;

create or replace function public.admin_resolve_report(p_id uuid, p_action text, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); r public.reports;
begin
  if p_action not in ('dismiss','warn','suspend','ban') then raise exception 'Bad action'; end if;
  select * into r from public.reports where id = p_id;
  if r.id is null then raise exception 'Report not found'; end if;
  if p_action in ('suspend','ban') then perform public.admin_set_status(r.target, case when p_action = 'ban' then 'banned' else 'suspended' end, 'Report: ' || r.reason); end if;
  update public.reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end, resolution = p_action, handled_by = me.id, handled_at = now() where id = p_id;
  perform public._audit(me.id, 'resolve_report', r.target::text, jsonb_build_object('action', p_action, 'reportId', p_id, 'note', p_note));
end $$;

create or replace function public.admin_verifications() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  return coalesce((select jsonb_agg(public._pub(p) || jsonb_build_object('email', p.email, 'verificationSelfie', p.verification_selfie) order by p.last_active)
    from public.profiles p where p.verification_status = 'pending'), '[]');
end $$;

create or replace function public.admin_decide_verification(p_id uuid, p_approve boolean) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  update public.profiles set verification_status = case when p_approve then 'approved' else 'rejected' end, verified = p_approve where id = p_id;
  perform public._audit(me.id, case when p_approve then 'verify_approve' else 'verify_reject' end, p_id::text);
end $$;

create or replace function public.admin_flagged() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'body', x.body, 'at', x.created_at, 'flagged', to_jsonb(x.flagged),
      'sender', jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'status', p.status)) order by x.created_at desc)
    from (select * from public.messages where array_length(flagged,1) > 0 and not cleared order by created_at desc limit 200) x join public.profiles p on p.id = x.sender), '[]');
end $$;

create or replace function public.admin_clear_flag(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); s uuid;
begin
  update public.messages set cleared = true where id = p_id returning sender into s;
  perform public._audit(me.id, 'clear_flag', s::text, jsonb_build_object('messageId', p_id));
end $$;

create or replace function public.super_set_role(p_id uuid, p_role text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin');
begin
  if p_role not in ('user','admin','superadmin') then raise exception 'Bad role'; end if;
  if p_id = me.id then raise exception 'You cannot change your own role.'; end if;
  update public.profiles set role = p_role where id = p_id;
  if not found then raise exception 'User not found'; end if;
  perform public._audit(me.id, 'set_role', p_id::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.super_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin'); cur jsonb := public._settings(); n jsonb;
begin
  n := jsonb_build_object(
    'dailyLikes', greatest(0, least(1000, coalesce((p->>'dailyLikes')::int, (cur->>'dailyLikes')::int))),
    'dailySuperLikes', greatest(0, least(100, coalesce((p->>'dailySuperLikes')::int, (cur->>'dailySuperLikes')::int))),
    'minAge', greatest(18, least(99, coalesce((p->>'minAge')::int, (cur->>'minAge')::int))),
    'scamShield', coalesce((p->>'scamShield')::boolean, (cur->>'scamShield')::boolean),
    'maintenance', coalesce((p->>'maintenance')::boolean, (cur->>'maintenance')::boolean),
    'undoEnabled', coalesce((p->>'undoEnabled')::boolean, (cur->>'undoEnabled')::boolean),
    'requireAdminMfa', coalesce((p->>'requireAdminMfa')::boolean, (cur->>'requireAdminMfa')::boolean),
    'announcement', left(coalesce(p->>'announcement', cur->>'announcement', ''), 280));
  update public.app_settings set data = n where id = 1;
  perform public._audit(me.id, 'save_settings', 'app', n);
  return n;
end $$;

create or replace function public.super_audit() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'action', a.action, 'meta', a.meta,
      'actorEmail', coalesce(pa.email, a.actor::text), 'targetEmail', coalesce(pt.email, a.target)) order by a.at desc)
    from (select * from public.audit_log order by at desc limit 300) a
    left join public.profiles pa on pa.id = a.actor
    left join public.profiles pt on pt.id::text = a.target), '[]');
end $$;

create or replace function public.super_analytics() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin');
begin
  return (with d as (select generate_series(current_date - 13, current_date, interval '1 day')::date as day)
    select jsonb_build_object(
      'days', (select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day) from d),
      'signups', (select jsonb_agg((select count(*) from public.profiles where created_at::date = d.day) order by d.day) from d),
      'matches', (select jsonb_agg((select count(*) from public.matches where created_at::date = d.day) order by d.day) from d),
      'messages', (select jsonb_agg((select count(*) from public.messages where created_at::date = d.day) order by d.day) from d),
      'byCountry', coalesce((select jsonb_object_agg(country, n) from (select country, count(*) n from public.profiles where country is not null and role = 'user' group by country) c), '{}'),
      'byIntent', coalesce((select jsonb_object_agg(intent, n) from (select intent, count(*) n from public.profiles where intent is not null and role = 'user' group by intent) c), '{}')));
end $$;

-- Sierra Leone Connect — sign-up identity: first/last name, unique username, country from sign-up.
alter table public.profiles add column if not exists last_name text check (char_length(last_name) <= 40);
alter table public.profiles add column if not exists username text
  check (username ~ '^[a-z0-9._]{3,20}$' and username !~ '^[._]' and username !~ '[._]$' and username !~ '[._]{2}');
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- Public, case-insensitive availability check used while typing on the sign-up form.
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(trim(p_username)) ~ '^[a-z0-9._]{3,20}$'
     and lower(trim(p_username)) !~ '^[._]' and lower(trim(p_username)) !~ '[._]$' and lower(trim(p_username)) !~ '[._]{2}'
     and not exists (select 1 from public.profiles where lower(username) = lower(trim(p_username)))
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- New auth user → profile. Validates sign-up metadata server-side (age, username) so it holds
-- even if someone bypasses the form. A raised error cancels the sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_user text := nullif(lower(trim(m->>'username')), '');
  v_dob date;
  min_age int := coalesce((public._settings()->>'minAge')::int, 18);
begin
  begin v_dob := nullif(m->>'dob', '')::date; exception when others then v_dob := null; end;
  if v_dob is not null and public._age(v_dob) < min_age then
    raise exception 'You must be %+ to use Sierra Leone Connect.', min_age;
  end if;
  if v_user is not null and not public.username_available(v_user) then
    raise exception 'That username is taken or invalid.';
  end if;
  insert into public.profiles (id, email, name, last_name, username, dob, country, city, lat, lng)
  values (new.id, lower(new.email),
    nullif(left(trim(m->>'first_name'), 30), ''), nullif(left(trim(m->>'last_name'), 40), ''), v_user, v_dob,
    nullif(left(trim(m->>'country'), 60), ''), nullif(left(trim(m->>'city'), 60), ''),
    round((nullif(m->>'lat', ''))::numeric, 2)::double precision, round((nullif(m->>'lng', ''))::numeric, 2)::double precision)
  on conflict (id) do nothing;
  insert into public.audit_log (actor, action, target) values (new.id, 'signup', new.id::text);
  return new;
end $$;

-- Username is public (shown as @handle); last name is private (owner + staff only).
create or replace function public._pub(p public.profiles) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'username', p.username, 'dob', p.dob, 'gender', p.gender, 'intent', p.intent,
    'city', p.city, 'country', p.country, 'lat', round(p.lat::numeric, 2), 'lng', round(p.lng::numeric, 2),
    'homeDistrict', p.home_district, 'heritage', p.heritage, 'faith', p.faith,
    'languages', to_jsonb(p.languages), 'interests', to_jsonb(p.interests), 'prompts', p.prompts,
    'photos', to_jsonb(p.photos), 'bio', p.bio, 'job', p.job, 'education', p.education, 'heightCm', p.height_cm,
    'verified', p.verified, 'lastActive', p.last_active, 'completeness', p.completeness, 'voice', p.voice_url, 'createdAt', p.created_at, 'prefs',
    jsonb_build_object('seeking', coalesce(p.prefs->'seeking','[]'), 'ageMin', p.prefs->'ageMin', 'ageMax', p.prefs->'ageMax'))
$$;

create or replace function public._full(p public.profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select public._pub(p) || jsonb_build_object('lat', p.lat, 'lng', p.lng, 'prefs', p.prefs, 'paused', p.paused, 'onboarded', p.onboarded,
    'verificationStatus', p.verification_status, 'streak', p.streak, 'createdAt', p.created_at, 'email', p.email, 'lastName', p.last_name,
    'answers', coalesce((select jsonb_object_agg(qid, jsonb_build_object('m', m, 'a', to_jsonb(a), 'i', i)) from public.answers where user_id = p.id), '{}'),
    'answersCount', (select count(*) from public.answers where user_id = p.id))
$$;

-- Staff member list shows the private last name too.
create or replace function public.admin_users(p_q text default '') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff(); q text := '%' || lower(coalesce(trim(p_q),'')) || '%';
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason, 'createdAt', p.created_at,
      'profile', public._pub(p) || jsonb_build_object('lastName', p.last_name)) order by p.created_at desc)
    from (select * from public.profiles where lower(coalesce(email,'')) like q or lower(coalesce(name,'')) like q or lower(coalesce(last_name,'')) like q
            or lower(coalesce(username,'')) like q or lower(coalesce(city,'')) like q order by created_at desc limit 200) p), '[]');
end $$;

-- Sierra Leone Connect — other members only ever see the username. First and last name are private
-- (returned to the owner via _full and to staff via admin_users).
create or replace function public._pub(p public.profiles) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', coalesce(p.username, 'member'), 'username', p.username, 'dob', p.dob, 'gender', p.gender, 'intent', p.intent,
    'city', p.city, 'country', p.country, 'lat', round(p.lat::numeric, 2), 'lng', round(p.lng::numeric, 2),
    'homeDistrict', p.home_district, 'heritage', p.heritage, 'faith', p.faith,
    'languages', to_jsonb(p.languages), 'interests', to_jsonb(p.interests), 'prompts', p.prompts,
    'photos', to_jsonb(p.photos), 'bio', p.bio, 'job', p.job, 'education', p.education, 'heightCm', p.height_cm,
    'verified', p.verified, 'lastActive', p.last_active, 'completeness', p.completeness, 'voice', p.voice_url, 'createdAt', p.created_at, 'prefs',
    jsonb_build_object('seeking', coalesce(p.prefs->'seeking','[]'), 'ageMin', p.prefs->'ageMin', 'ageMax', p.prefs->'ageMax'))
$$;

create or replace function public._full(p public.profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select public._pub(p) || jsonb_build_object('name', p.name, 'firstName', p.name, 'lastName', p.last_name,
    'lat', p.lat, 'lng', p.lng, 'prefs', p.prefs, 'paused', p.paused, 'onboarded', p.onboarded,
    'verificationStatus', p.verification_status, 'streak', p.streak, 'createdAt', p.created_at, 'email', p.email,
    'answers', coalesce((select jsonb_object_agg(qid, jsonb_build_object('m', m, 'a', to_jsonb(a), 'i', i)) from public.answers where user_id = p.id), '{}'),
    'answersCount', (select count(*) from public.answers where user_id = p.id))
$$;

create or replace function public.admin_users(p_q text default '') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff(); q text := '%' || lower(coalesce(trim(p_q),'')) || '%';
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason, 'createdAt', p.created_at,
      'profile', public._pub(p) || jsonb_build_object('firstName', p.name, 'lastName', p.last_name)) order by p.created_at desc)
    from (select * from public.profiles where lower(coalesce(email,'')) like q or lower(coalesce(name,'')) like q or lower(coalesce(last_name,'')) like q
            or lower(coalesce(username,'')) like q or lower(coalesce(city,'')) like q order by created_at desc limit 200) p), '[]');
end $$;

-- ─────────────────────────── Grants ───────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_settings() to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public._is_member(uuid) to authenticated;
grant execute on function
  public.my_session(), public.get_me(), public.save_profile(jsonb), public.request_verification(text), public.quota(),
  public.get_deck(text), public.swipe(uuid, text, text, text), public.undo_swipe(), public.likes_you(), public.my_matches(),
  public.get_messages(uuid), public.send_message(uuid, text, text, text, jsonb), public.unmatch(uuid),
  public.save_answer(text, int, int[], int, boolean), public.remove_answer(text), public.extend_match(uuid), public.report_user(uuid, text, text, uuid),
  public.block_user(uuid), public.touch_streak(), public.delete_account(),
  public.admin_stats(), public.admin_users(text), public.admin_set_status(uuid, text, text), public.admin_reports(text),
  public.admin_resolve_report(uuid, text, text), public.admin_verifications(), public.admin_decide_verification(uuid, boolean),
  public.admin_flagged(), public.admin_clear_flag(uuid), public.super_set_role(uuid, text), public.super_save_settings(jsonb),
  public.super_audit(), public.super_analytics()
to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ═══ SUPABASE-PLATFORM SECTION (storage + realtime) ═══
-- Photos: public bucket, members write only inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/ogg'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;
-- Voice notes: private bucket, path = <match_id>/<file>; only the two members can read/write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 2097152, array['audio/webm','audio/mp4','audio/ogg'])
on conflict (id) do nothing;
-- Verification selfies: private bucket, readable by the owner and staff only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verifications', 'verifications', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos insert own" on storage.objects;
create policy "photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id in ('photos','verifications') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos delete own" on storage.objects;
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create or replace function public._is_member_txt(p text) returns boolean language plpgsql stable security definer set search_path = public as $$
begin return public._is_member(p::uuid); exception when others then return false; end $$;
grant execute on function public._is_member_txt(text) to authenticated;
drop policy if exists "voice insert member" on storage.objects;
create policy "voice insert member" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and public._is_member_txt((storage.foldername(name))[1]));
drop policy if exists "voice read member" on storage.objects;
create policy "voice read member" on storage.objects for select to authenticated
  using (bucket_id = 'voice' and public._is_member_txt((storage.foldername(name))[1]));
drop policy if exists "verifications read" on storage.objects;
create policy "verifications read" on storage.objects for select to authenticated
  using (bucket_id = 'verifications' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','superadmin') and p.status = 'active')));

-- Account deletion: list own uploads so the client can remove them via the Storage API
create or replace function public.my_media() returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare me public.profiles := public._me();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name))
    from storage.objects o where o.owner = me.id and o.bucket_id in ('photos', 'voice', 'verifications')), '[]');
end $$;
grant execute on function public.my_media() to authenticated;
drop policy if exists "voice delete own" on storage.objects;
create policy "voice delete own" on storage.objects for delete to authenticated using (bucket_id = 'voice' and owner = auth.uid());
drop policy if exists "verifications delete own" on storage.objects;
create policy "verifications delete own" on storage.objects for delete to authenticated using (bucket_id = 'verifications' and owner = auth.uid());

-- Realtime for chat
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ═══ BOOTSTRAP YOUR FIRST SUPERADMIN ═══
-- 1) Sign up in the app with your email.  2) Run (replace the email):
-- update public.profiles set role = 'superadmin' where email = 'you@example.com';
