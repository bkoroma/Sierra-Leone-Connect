-- Sierra Leone Connect — app health & operations (v1.5)
-- • System health for SuperAdmins: config checks, moderation backlog, auth/e-mail delivery, staff 2FA, storage, errors.
-- • Client error reporting (rate-limited, de-duplicated) so crashes on members' phones are visible to staff.
-- • Support / safety e-mail editable from App settings (used by the app and the policy pages).
-- • The last SuperAdmin can't delete their own account (the app would be left without an owner).
-- • Staff can see whether a member confirmed their e-mail, add private notes, and log reset / confirmation e-mails.
-- • Verification queue knows how long each selfie has been waiting.
-- • Indexes for every foreign key used by moderation and account deletion.

alter table public.profiles add column if not exists verification_requested_at timestamptz;

create index if not exists answers_qid_idx on public.answers (qid);
create index if not exists blocks_blocked_idx on public.blocks (blocked);
create index if not exists matches_user_b_idx on public.matches (user_b);
create index if not exists messages_sender_idx on public.messages (sender, created_at desc);
create index if not exists reports_target_idx on public.reports (target, status);
create index if not exists reports_reporter_idx on public.reports (reporter, created_at desc);
create index if not exists reports_message_idx on public.reports (message_id);
create index if not exists reports_handled_by_idx on public.reports (handled_by);
create index if not exists reports_open_idx on public.reports (created_at) where status = 'open';
create index if not exists audit_target_idx on public.audit_log (target, at desc);
create index if not exists audit_action_idx on public.audit_log (action, at desc);

-- ─────────── Client error reports ───────────
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  sig text not null,                       -- page + message, used to group repeats
  page text, message text not null, stack text, ua text, version text,
  user_id uuid,
  count int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create unique index if not exists client_errors_sig_idx on public.client_errors (sig);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

-- Anyone (signed in or not) can report an error. Repeats only bump a counter, and the table is capped,
-- so this can't be used to fill the database.
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
  if (select count(*) from public.client_errors) >= 500 then return; end if;
  insert into public.client_errors (sig, page, message, stack, ua, version, user_id)
  values (v_sig, v_page, v_msg, left(coalesce(p_stack, ''), 2000), left(coalesce(p_ua, ''), 200), left(coalesce(p_version, ''), 20), auth.uid())
  on conflict (sig) do update set count = public.client_errors.count + 1, last_at = now();
end $$;

create or replace function public.super_clear_errors() returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin'); n int;
begin
  select count(*) into n from public.client_errors;
  delete from public.client_errors where true;
  perform public._audit(me.id, 'clear_errors', 'app', jsonb_build_object('rows', n));
end $$;

-- ─────────── System health ───────────
create or replace function public.super_health() returns jsonb language plpgsql stable security definer set search_path = public, auth, storage as $$
declare me public.profiles := public._staff('superadmin');
begin
  return jsonb_build_object(
    'schema', 15,
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

-- ─────────── Settings: support e-mails ───────────
create or replace function public.super_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin'); cur jsonb := public._settings(); n jsonb;
  em text := '^[^@\s]+@[^@\s]+\.[a-z]{2,}$';
  v_support text := lower(trim(coalesce(p->>'supportEmail', cur->>'supportEmail', '')));
  v_safety text := lower(trim(coalesce(p->>'safetyEmail', cur->>'safetyEmail', '')));
begin
  if v_support <> '' and v_support !~* em then raise exception 'Support e-mail doesn''t look right.'; end if;
  if v_safety <> '' and v_safety !~* em then raise exception 'Safety e-mail doesn''t look right.'; end if;
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
    'announcement', left(coalesce(p->>'announcement', cur->>'announcement', ''), 280));
  update public.app_settings set data = jsonb_strip_nulls(n) where id = 1;
  perform public._audit(me.id, 'save_settings', 'app', n);
  return jsonb_strip_nulls(n);
end $$;

-- ─────────── Accounts ───────────
create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$
declare me public.profiles := public._me();
begin
  if me.role = 'superadmin' and not exists (select 1 from public.profiles where role = 'superadmin' and status = 'active' and id <> me.id) then
    raise exception 'You are the only SuperAdmin. Make another member SuperAdmin before deleting this account.';
  end if;
  insert into public.audit_log (actor, action, target, meta) values (me.id, 'account_deleted', me.id::text, jsonb_strip_nulls(jsonb_build_object('username', me.username)));
  delete from auth.users where id = me.id; -- cascades to profile, swipes, matches, messages
end $$;

create or replace function public.request_verification(p_selfie text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if p_selfie !~ ('^verifications/' || me.id::text || '/') then raise exception 'Invalid selfie path.'; end if;
  update public.profiles set verification_selfie = p_selfie, verification_status = 'pending', verification_requested_at = now() where id = me.id;
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.admin_note(p_id uuid, p_text text default '', p_kind text default 'note') returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles; v text := nullif(left(trim(coalesce(p_text, '')), 1000), '');
begin
  if p_kind not in ('note', 'send_reset', 'resend_confirm') then raise exception 'Bad kind'; end if;
  if p_kind = 'note' and v is null then raise exception 'Write the note.'; end if;
  t := public._admin_target(me, p_id);
  perform public._audit(me.id, p_kind, p_id::text, jsonb_strip_nulls(jsonb_build_object('note', v)));
end $$;

-- Members list + detail now show whether the e-mail is confirmed and when they last signed in.
create or replace function public._admin_row(p public.profiles) returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason,
    'suspendedUntil', p.suspended_until, 'createdAt', p.created_at, 'lastActive', p.last_active,
    'emailConfirmed', (select u.email_confirmed_at is not null from auth.users u where u.id = p.id),
    'openReports', (select count(*) from public.reports r where r.target = p.id and r.status = 'open'),
    'profile', public._pub(p) || jsonb_build_object('firstName', p.name, 'lastName', p.last_name, 'verificationStatus', p.verification_status, 'onboarded', p.onboarded))
$$;

create or replace function public.admin_members(p_q text default '', p_filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare me public.profiles := public._staff(); q text := '%' || lower(coalesce(trim(p_q), '')) || '%';
begin
  if p_filter not in ('all','active','suspended','banned','staff','pending','verified','unverified','reported','unconfirmed','onboarding') then raise exception 'Bad filter'; end if;
  return coalesce((select jsonb_agg(public._admin_row(p) order by p.created_at desc) from (
    select * from public.profiles x
    where (lower(coalesce(x.email,'')) like q or lower(coalesce(x.name,'')) like q or lower(coalesce(x.last_name,'')) like q
           or lower(coalesce(x.username,'')) like q or lower(coalesce(x.city,'')) like q or lower(coalesce(x.country,'')) like q)
      and case p_filter
            when 'active' then x.status = 'active' when 'suspended' then x.status = 'suspended' when 'banned' then x.status = 'banned'
            when 'staff' then x.role <> 'user' when 'pending' then x.verification_status = 'pending'
            when 'verified' then x.verified when 'unverified' then not x.verified and x.role = 'user'
            when 'reported' then exists (select 1 from public.reports r where r.target = x.id and r.status = 'open')
            when 'unconfirmed' then exists (select 1 from auth.users u where u.id = x.id and u.email_confirmed_at is null)
            when 'onboarding' then not x.onboarded and x.role = 'user'
            else true end
    order by x.created_at desc limit 500) p), '[]');
end $$;

create or replace function public.admin_member(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare me public.profiles := public._staff(); p public.profiles; u auth.users;
begin
  select * into p from public.profiles where id = p_id;
  if p.id is null then raise exception 'User not found'; end if;
  select * into u from auth.users where id = p_id;
  return public._pub(p) || jsonb_build_object(
    'firstName', p.name, 'lastName', p.last_name, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason,
    'suspendedUntil', p.suspended_until, 'verificationStatus', p.verification_status, 'onboarded', p.onboarded, 'paused', p.paused,
    'notice', p.notice, 'noticeAt', p.notice_at,
    'emailConfirmed', u.email_confirmed_at is not null, 'lastSignIn', u.last_sign_in_at,
    'counts', jsonb_build_object(
      'matches', (select count(*) from public.matches m where p.id in (m.user_a, m.user_b) and m.unmatched_at is null),
      'messages', (select count(*) from public.messages where sender = p.id),
      'likesSent', (select count(*) from public.swipes where swiper = p.id and kind <> 'pass'),
      'likesReceived', (select count(*) from public.swipes where target = p.id and kind <> 'pass'),
      'reportsAgainst', (select count(*) from public.reports where target = p.id),
      'reportsMade', (select count(*) from public.reports where reporter = p.id),
      'blockedBy', (select count(*) from public.blocks where blocked = p.id),
      'flagged', (select count(*) from public.messages where sender = p.id and array_length(flagged, 1) > 0)),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status,
        'resolution', r.resolution, 'at', r.created_at, 'reporter', rp.username) order by r.created_at desc)
      from (select * from public.reports where target = p.id order by created_at desc limit 20) r left join public.profiles rp on rp.id = r.reporter), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'actor', coalesce(pa.email, a.actor::text), 'meta', a.meta) order by a.at desc)
      from (select * from public.audit_log where target = p.id::text order by at desc limit 40) a left join public.profiles pa on pa.id = a.actor), '[]'));
end $$;

-- Verification queue shows how long each request has waited.
create or replace function public.admin_verifications() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  return coalesce((select jsonb_agg(public._pub(p) || jsonb_build_object('email', p.email, 'verificationSelfie', p.verification_selfie,
      'requestedAt', p.verification_requested_at) order by p.verification_requested_at nulls first)
    from public.profiles p where p.verification_status = 'pending'), '[]');
end $$;

-- Maintenance mode is enforced by the server too (it used to only hide the app's screens, so an open app kept working).
create or replace function public._me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Please log in again.'; end if;
  if p.status = 'banned' then raise exception 'This account has been banned.'; end if;
  if p.status = 'suspended' then
    if p.suspended_until is not null and p.suspended_until <= now() then
      p.status := 'active';
    else
      raise exception 'This account is suspended%. %',
        coalesce(' until ' || to_char(p.suspended_until at time zone 'UTC', 'Mon DD, YYYY HH24:MI "UTC"'), ''), coalesce(p.status_reason, '');
    end if;
  end if;
  if p.role = 'user' and coalesce((public._settings()->>'maintenance')::boolean, false) then
    raise exception 'Sierra Leone Connect is down for maintenance. Please check back soon.';
  end if;
  return p;
end $$;

revoke execute on function
  public.log_client_error(text, text, text, text, text), public.super_clear_errors(), public.super_health(),
  public.admin_note(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.super_clear_errors(), public.super_health(), public.admin_note(uuid, text, text) to authenticated;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;
