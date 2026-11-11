-- Sierra Leone Connect — compliance pass (v1.6)
-- • Consent records: when each member accepted the Terms/Privacy (and which version) and gave explicit consent
--   to the sensitive details a dating profile involves (faith, heritage, who they're interested in).
-- • "Download my data": a member can export everything we hold about them (GDPR/UK GDPR access + portability, CCPA).
-- • Data minimisation:
--   – verification selfies are deleted as soon as a moderator decides;
--   – error reports are kept 30 days;
--   – deletion records keep a one-way hash of the e-mail, never the e-mail or username.
-- • Banned people can't come back with the same e-mail after deleting their account.
-- • Operator (business) details editable in App settings and shown on the legal pages.

alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists sensitive_consent_at timestamptz;

create table if not exists public.banned_emails (
  hash text primary key,              -- sha256 of the lower-cased e-mail; the address itself is not kept
  at timestamptz not null default now()
);
alter table public.banned_emails enable row level security;
revoke all on public.banned_emails from anon, authenticated;

create or replace function public._email_hash(p text) returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(lower(trim(coalesce(p, ''))), 'UTF8')), 'hex')
$$;

-- ─────────── Consent ───────────
create or replace function public.accept_terms(p_version text, p_sensitive boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if coalesce(trim(p_version), '') = '' then raise exception 'Missing terms version.'; end if;
  if not p_sensitive then raise exception 'Sierra Leone Connect needs this consent to show you matches.'; end if;
  update public.profiles set terms_version = left(p_version, 20), terms_accepted_at = now(),
    sensitive_consent_at = coalesce(sensitive_consent_at, now()) where id = me.id;
  insert into public.audit_log (actor, action, target, meta) values (me.id, 'accept_terms', me.id::text, jsonb_build_object('version', left(p_version, 20)));
  return jsonb_build_object('termsVersion', left(p_version, 20));
end $$;

create or replace function public._full(p public.profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select public._pub(p) || jsonb_build_object('name', p.name, 'firstName', p.name, 'lastName', p.last_name,
    'lat', p.lat, 'lng', p.lng, 'prefs', p.prefs, 'paused', p.paused, 'onboarded', p.onboarded,
    'verificationStatus', p.verification_status, 'streak', p.streak, 'createdAt', p.created_at, 'email', p.email,
    'notice', p.notice, 'noticeAt', p.notice_at,
    'termsVersion', p.terms_version, 'termsAcceptedAt', p.terms_accepted_at, 'sensitiveConsentAt', p.sensitive_consent_at,
    'answers', coalesce((select jsonb_object_agg(qid, jsonb_build_object('m', m, 'a', to_jsonb(a), 'i', i)) from public.answers where user_id = p.id), '{}'),
    'answersCount', (select count(*) from public.answers where user_id = p.id))
$$;

-- ─────────── Download my data ───────────
create or replace function public.export_my_data() returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare me public.profiles := public._me(); u auth.users;
begin
  select * into u from auth.users where id = me.id;
  return jsonb_build_object(
    'exportedAt', now(),
    'service', 'Sierra Leone Connect',
    'account', jsonb_build_object('id', me.id, 'email', me.email, 'createdAt', me.created_at, 'emailConfirmedAt', u.email_confirmed_at,
      'lastSignInAt', u.last_sign_in_at, 'status', me.status, 'termsVersion', me.terms_version, 'termsAcceptedAt', me.terms_accepted_at,
      'sensitiveConsentAt', me.sensitive_consent_at),
    'profile', jsonb_build_object('firstName', me.name, 'lastName', me.last_name, 'username', me.username, 'dateOfBirth', me.dob,
      'gender', me.gender, 'relationshipGoal', me.intent, 'city', me.city, 'country', me.country, 'approxLatitude', me.lat, 'approxLongitude', me.lng,
      'homeDistrict', me.home_district, 'heritage', me.heritage, 'faith', me.faith, 'languages', me.languages, 'interests', me.interests,
      'prompts', me.prompts, 'bio', me.bio, 'job', me.job, 'education', me.education, 'heightCm', me.height_cm, 'photos', me.photos,
      'voiceIntro', me.voice_url, 'discoveryPreferences', me.prefs, 'paused', me.paused, 'verified', me.verified,
      'verificationStatus', me.verification_status, 'lastActive', me.last_active, 'streak', me.streak),
    'compatibilityAnswers', coalesce((select jsonb_agg(jsonb_build_object('question', a.qid, 'myAnswer', a.m, 'acceptable', to_jsonb(a.a), 'importance', a.i) order by a.qid)
      from public.answers a where a.user_id = me.id), '[]'),
    'likesAndPassesISent', coalesce((select jsonb_agg(jsonb_build_object('to', coalesce(t.username, 'deleted member'), 'kind', s.kind, 'comment', nullif(s.comment, ''), 'at', s.created_at) order by s.created_at)
      from public.swipes s left join public.profiles t on t.id = s.target where s.swiper = me.id), '[]'),
    'likesReceivedCount', (select count(*) from public.swipes where target = me.id and kind <> 'pass'),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('with', coalesce(o.username, 'deleted member'), 'matchedAt', m.created_at, 'unmatchedAt', m.unmatched_at) order by m.created_at)
      from public.matches m left join public.profiles o on o.id = case when m.user_a = me.id then m.user_b else m.user_a end
      where me.id in (m.user_a, m.user_b)), '[]'),
    'messagesISent', coalesce((select jsonb_agg(jsonb_build_object('to', coalesce(o.username, 'deleted member'), 'kind', x.kind, 'text', x.body, 'media', x.media, 'at', x.created_at) order by x.created_at)
      from public.messages x join public.matches m on m.id = x.match_id
      left join public.profiles o on o.id = case when m.user_a = me.id then m.user_b else m.user_a end
      where x.sender = me.id), '[]'),
    'reportsIMade', coalesce((select jsonb_agg(jsonb_build_object('about', coalesce(t.username, 'deleted member'), 'reason', r.reason, 'details', r.details, 'status', r.status, 'at', r.created_at) order by r.created_at)
      from public.reports r left join public.profiles t on t.id = r.target where r.reporter = me.id), '[]'),
    'peopleIBlocked', coalesce((select jsonb_agg(jsonb_build_object('who', coalesce(t.username, 'deleted member'), 'at', b.created_at) order by b.created_at)
      from public.blocks b left join public.profiles t on t.id = b.blocked where b.blocker = me.id), '[]'),
    'moderationOnMyAccount', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.at,
        'details', a.meta - 'note' - 'email' - 'username' - 'emailHash') order by a.at)
      from public.audit_log a where a.target = me.id::text and a.action in ('warn','suspend','ban','reinstate','edit_member','verify_approve','verify_reject','resolve_report','accept_terms')), '[]'),
    'warningWaitingForYou', me.notice);
end $$;

-- ─────────── Data minimisation ───────────
-- Selfies are only needed until a moderator decides: the reference is cleared here and the console deletes the file.
create or replace function public.admin_decide_verification(p_id uuid, p_approve boolean) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles;
begin
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.verification_status <> 'pending' then raise exception 'This verification was already decided.'; end if;
  update public.profiles set verification_status = case when p_approve then 'approved' else 'rejected' end, verified = p_approve,
    verification_selfie = null where id = p_id;
  perform public._recalc(p_id);
  perform public._audit(me.id, case when p_approve then 'verify_approve' else 'verify_reject' end, p_id::text);
end $$;

-- Error reports: same as v1.5, plus anything older than 30 days is removed.
create or replace function public.log_client_error(p_page text, p_message text, p_stack text default '', p_ua text default '', p_version text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_msg text := left(trim(coalesce(p_message, '')), 300); v_page text := left(coalesce(p_page, ''), 80); v_sig text;
begin
  if v_msg = '' then return; end if;
  v_sig := md5(v_page || '|' || regexp_replace(v_msg, '[0-9a-f]{8}-[0-9a-f-]{27,}|\d+', '#', 'g'));
  update public.client_errors set count = least(count + 1, 1000000), last_at = now(),
    stack = coalesce(nullif(left(p_stack, 2000), ''), stack), ua = left(coalesce(p_ua, ''), 200), version = left(coalesce(p_version, ''), 20),
    user_id = coalesce(auth.uid(), user_id)
  where sig = v_sig;
  if found then return; end if;
  delete from public.client_errors where last_at < now() - interval '30 days';
  if (select count(*) from public.client_errors) >= 500 then return; end if;
  insert into public.client_errors (sig, page, message, stack, ua, version, user_id)
  values (v_sig, v_page, v_msg, left(coalesce(p_stack, ''), 2000), left(coalesce(p_ua, ''), 200), left(coalesce(p_version, ''), 20), auth.uid())
  on conflict (sig) do update set count = public.client_errors.count + 1, last_at = now();
end $$;

-- Account deletion keeps no e-mail or username. A banned person's e-mail hash is kept so they can't simply re-register.
create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();          -- banned/suspended members may still delete
  if me.id is null then raise exception 'Please log in again.'; end if;
  if me.role = 'superadmin' and not exists (select 1 from public.profiles where role = 'superadmin' and status = 'active' and id <> me.id) then
    raise exception 'You are the only SuperAdmin. Make another member SuperAdmin before deleting this account.';
  end if;
  if me.status = 'banned' then insert into public.banned_emails (hash) values (public._email_hash(me.email)) on conflict do nothing; end if;
  insert into public.audit_log (actor, action, target) values (null, 'account_deleted', me.id::text);
  delete from auth.users where id = me.id;
end $$;

create or replace function public.super_delete_user(p_id uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare me public.profiles := public._staff('superadmin'); t public.profiles;
begin
  if p_id = me.id then raise exception 'You cannot delete your own account from the console.'; end if;
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role = 'superadmin' then raise exception 'Remove the SuperAdmin role before deleting this account.'; end if;
  if t.status = 'banned' then insert into public.banned_emails (hash) values (public._email_hash(t.email)) on conflict do nothing; end if;
  perform public._audit(me.id, 'delete_user', p_id::text, jsonb_build_object('wasBanned', t.status = 'banned', 'emailHash', left(public._email_hash(t.email), 12)));
  delete from auth.users where id = p_id;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_user text := nullif(lower(trim(m->>'username')), '');
  v_gender text := case when m->>'gender' in ('woman', 'man') then m->>'gender' end;
  v_terms text := nullif(left(trim(coalesce(m->>'terms_version', '')), 20), '');
  v_dob date;
  min_age int := coalesce((public._settings()->>'minAge')::int, 18);
begin
  if not coalesce((public._settings()->>'signupsOpen')::boolean, true) then
    raise exception 'New sign-ups are paused right now. Please try again later.';
  end if;
  if exists (select 1 from public.banned_emails where hash = public._email_hash(new.email)) then
    raise exception 'This email address can''t be used to create an account.';
  end if;
  begin v_dob := nullif(m->>'dob', '')::date; exception when others then v_dob := null; end;
  if v_dob is not null and public._age(v_dob) < min_age then
    raise exception 'You must be %+ to use Sierra Leone Connect.', min_age;
  end if;
  if v_user is not null and not public.username_available(v_user) then
    raise exception 'That username is taken or invalid.';
  end if;
  insert into public.profiles (id, email, name, last_name, username, gender, dob, country, city, lat, lng, prefs,
    terms_version, terms_accepted_at, sensitive_consent_at)
  values (new.id, lower(new.email),
    nullif(left(trim(m->>'first_name'), 30), ''), nullif(left(trim(m->>'last_name'), 40), ''), v_user, v_gender, v_dob,
    nullif(left(trim(m->>'country'), 60), ''), nullif(left(trim(m->>'city'), 60), ''),
    round((nullif(m->>'lat', ''))::numeric, 2)::double precision, round((nullif(m->>'lng', ''))::numeric, 2)::double precision,
    case v_gender when 'man' then '{"seeking":["woman"]}'::jsonb when 'woman' then '{"seeking":["man"]}'::jsonb else '{}'::jsonb end,
    v_terms, case when v_terms is not null then now() end,
    case when coalesce((m->>'sensitive_consent')::boolean, false) then now() end)
  on conflict (id) do nothing;
  insert into public.audit_log (actor, action, target) values (new.id, 'signup', new.id::text);
  return new;
end $$;

-- Business details shown on the legal pages; editable by the SuperAdmin.
create or replace function public.super_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin'); cur jsonb := public._settings(); n jsonb;
  em text := '^[^@\s]+@[^@\s]+\.[a-z]{2,}$';
  v_support text := lower(trim(coalesce(p->>'supportEmail', cur->>'supportEmail', '')));
  v_safety text := lower(trim(coalesce(p->>'safetyEmail', cur->>'safetyEmail', '')));
  txt text := '[<>]';
begin
  if v_support <> '' and v_support !~* em then raise exception 'Support e-mail doesn''t look right.'; end if;
  if v_safety <> '' and v_safety !~* em then raise exception 'Safety e-mail doesn''t look right.'; end if;
  if coalesce(p->>'operatorName', '') ~ txt or coalesce(p->>'operatorAddress', '') ~ txt or coalesce(p->>'operatorCountry', '') ~ txt then
    raise exception 'Business details can''t contain < or >.';
  end if;
  n := jsonb_build_object(
    'dailyLikes', greatest(0, least(1000, coalesce((p->>'dailyLikes')::int, (cur->>'dailyLikes')::int))),
    'dailySuperLikes', greatest(0, least(100, coalesce((p->>'dailySuperLikes')::int, (cur->>'dailySuperLikes')::int))),
    'minAge', greatest(18, least(99, coalesce((p->>'minAge')::int, (cur->>'minAge')::int))),
    'scamShield', coalesce((p->>'scamShield')::boolean, (cur->>'scamShield')::boolean),
    'maintenance', coalesce((p->>'maintenance')::boolean, (cur->>'maintenance')::boolean),
    'undoEnabled', coalesce((p->>'undoEnabled')::boolean, (cur->>'undoEnabled')::boolean),
    'requireAdminMfa', coalesce((p->>'requireAdminMfa')::boolean, (cur->>'requireAdminMfa')::boolean),
    'signupsOpen', coalesce((p->>'signupsOpen')::boolean, (cur->>'signupsOpen')::boolean, true),
    'supportEmail', nullif(v_support, ''),
    'safetyEmail', nullif(v_safety, ''),
    'operatorName', nullif(left(trim(coalesce(p->>'operatorName', cur->>'operatorName', '')), 120), ''),
    'operatorAddress', nullif(left(trim(coalesce(p->>'operatorAddress', cur->>'operatorAddress', '')), 300), ''),
    'operatorCountry', nullif(left(trim(coalesce(p->>'operatorCountry', cur->>'operatorCountry', '')), 60), ''),
    'announcement', left(coalesce(p->>'announcement', cur->>'announcement', ''), 280));
  update public.app_settings set data = jsonb_strip_nulls(n) where id = 1;
  perform public._audit(me.id, 'save_settings', 'app', n);
  return jsonb_strip_nulls(n);
end $$;

-- Health reports the schema version this migration brings (16).
create or replace function public._schema_version() returns int language sql immutable set search_path = public as $$ select 16 $$;

create or replace function public.super_health() returns jsonb language plpgsql stable security definer set search_path = public, auth, storage as $$
declare me public.profiles := public._staff('superadmin');
begin
  return jsonb_build_object(
    'schema', public._schema_version(),
    'now', now(),
    'dbSize', pg_database_size(current_database()),
    'settings', public._settings(),
    'tables', jsonb_build_object(
      'profiles', (select count(*) from public.profiles), 'swipes', (select count(*) from public.swipes),
      'matches', (select count(*) from public.matches), 'messages', (select count(*) from public.messages),
      'answers', (select count(*) from public.answers), 'reports', (select count(*) from public.reports),
      'blocks', (select count(*) from public.blocks), 'audit_log', (select count(*) from public.audit_log),
      'client_errors', (select count(*) from public.client_errors)),
    'storage', coalesce((select jsonb_agg(jsonb_build_object('bucket', b.id, 'files', coalesce(o.n, 0), 'bytes', coalesce(o.bytes, 0)) order by b.id)
      from storage.buckets b left join (select bucket_id, count(*) n, sum(coalesce((metadata->>'size')::bigint, 0)) bytes from storage.objects group by bucket_id) o on o.bucket_id = b.id), '[]'),
    'auth', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'signups7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'unconfirmed7d', (select count(*) from auth.users where created_at > now() - interval '7 days' and email_confirmed_at is null),
      'unconfirmedOld', (select count(*) from auth.users where created_at < now() - interval '1 day' and email_confirmed_at is null),
      'lastSignup', (select max(created_at) from auth.users),
      'lastSignIn', (select max(last_sign_in_at) from auth.users)),
    'staff', jsonb_build_object(
      'superadmins', (select count(*) from public.profiles where role = 'superadmin' and status = 'active'),
      'admins', (select count(*) from public.profiles where role = 'admin' and status = 'active'),
      'without2fa', coalesce((select jsonb_agg(p.email order by p.email) from public.profiles p where p.role <> 'user' and p.status = 'active'
          and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')), '[]')),
    'members', jsonb_build_object(
      'total', (select count(*) from public.profiles where role = 'user'),
      'onboarded', (select count(*) from public.profiles where role = 'user' and onboarded),
      'stuckOnboarding', (select count(*) from public.profiles where role = 'user' and not onboarded and created_at < now() - interval '1 day'),
      'active7d', (select count(*) from public.profiles where role = 'user' and last_active > now() - interval '7 days'),
      'noPhotos', (select count(*) from public.profiles where role = 'user' and onboarded and coalesce(cardinality(photos), 0) = 0),
      'suspended', (select count(*) from public.profiles where status = 'suspended'),
      'banned', (select count(*) from public.profiles where status = 'banned')),
    'consent', jsonb_build_object(
      'missing', (select count(*) from public.profiles where role = 'user' and (terms_accepted_at is null or sensitive_consent_at is null)),
      'bannedEmailHashes', (select count(*) from public.banned_emails)),
    'backlog', jsonb_build_object(
      'openReports', (select count(*) from public.reports where status = 'open'),
      'oldestReport', (select min(created_at) from public.reports where status = 'open'),
      'pendingVerifications', (select count(*) from public.profiles where verification_status = 'pending'),
      'oldestVerification', (select min(verification_requested_at) from public.profiles where verification_status = 'pending'),
      'flagged', (select count(*) from public.messages where array_length(flagged, 1) > 0 and not cleared),
      'oldestFlag', (select min(created_at) from public.messages where array_length(flagged, 1) > 0 and not cleared)),
    'errors', jsonb_build_object(
      'last24h', (select coalesce(sum(count), 0) from public.client_errors where last_at > now() - interval '1 day'),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('page', e.page, 'message', e.message, 'stack', e.stack, 'ua', e.ua, 'version', e.version,
          'count', e.count, 'firstAt', e.first_at, 'lastAt', e.last_at) order by e.last_at desc)
        from (select * from public.client_errors order by last_at desc limit 40) e), '[]')));
end $$;

revoke execute on function public.accept_terms(text, boolean), public.export_my_data(), public._email_hash(text), public._schema_version()
from public, anon, authenticated;
grant execute on function public.accept_terms(text, boolean), public.export_my_data() to authenticated;
