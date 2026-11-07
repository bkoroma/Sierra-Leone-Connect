-- Sierra Leone Connect — staff console upgrade
-- • Warnings are actually delivered: the member sees the message the next time they open the app.
-- • Timed suspensions (1–365 days) that lift themselves.
-- • Member detail: full profile, counts, reports and staff history; remove photos / bio / prompts / voice; revoke verification.
-- • Members search with status filters; reports can't be handled twice; banning closes the member's other open reports.
-- • SuperAdmin: permanently delete an account (and its uploads), pause new sign-ups, richer analytics.
-- • Storage: staff access to selfies and media honours the 2FA rule; owners can always clean up their own files.

alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists notice text check (char_length(notice) <= 500);
alter table public.profiles add column if not exists notice_at timestamptz;
update public.app_settings set data = data || '{"signupsOpen": true}' where id = 1 and not data ? 'signupsOpen';

-- Boolean staff check (no exceptions) for storage policies. Respects the "Require 2FA for staff" setting.
create or replace function public._is_staff(p_level text default 'admin') returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'
                   and (p.role = 'superadmin' or (p_level = 'admin' and p.role = 'admin')))
     and (not coalesce((public._settings()->>'requireAdminMfa')::boolean, true) or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2')
$$;

-- A suspension whose end date has passed no longer blocks the member.
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
  return p;
end $$;

create or replace function public.my_session() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'email', email, 'role', role,
    'status', case when status = 'suspended' and suspended_until <= now() then 'active' else status end,
    'statusReason', status_reason, 'suspendedUntil', suspended_until)
  from public.profiles where id = auth.uid()
$$;

create or replace function public._full(p public.profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select public._pub(p) || jsonb_build_object('name', p.name, 'firstName', p.name, 'lastName', p.last_name,
    'lat', p.lat, 'lng', p.lng, 'prefs', p.prefs, 'paused', p.paused, 'onboarded', p.onboarded,
    'verificationStatus', p.verification_status, 'streak', p.streak, 'createdAt', p.created_at, 'email', p.email,
    'notice', p.notice, 'noticeAt', p.notice_at,
    'answers', coalesce((select jsonb_object_agg(qid, jsonb_build_object('m', m, 'a', to_jsonb(a), 'i', i)) from public.answers where user_id = p.id), '{}'),
    'answersCount', (select count(*) from public.answers where user_id = p.id))
$$;

-- Opening the app lifts an expired suspension for good.
create or replace function public.get_me() returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles := public._me();
begin
  update public.profiles set last_active = now(),
    status = case when status = 'suspended' and suspended_until <= now() then 'active' else status end,
    status_reason = case when status = 'suspended' and suspended_until <= now() then null else status_reason end,
    suspended_until = case when status = 'suspended' and suspended_until <= now() then null else suspended_until end
  where id = p.id returning * into p;
  return public._full(p);
end $$;

create or replace function public.ack_notice() returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  update public.profiles set notice = null, notice_at = null where id = me.id;
end $$;

-- ─────────── Moderation ───────────
create or replace function public._admin_target(me public.profiles, p_id uuid) returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare t public.profiles;
begin
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role <> 'user' and me.role <> 'superadmin' then raise exception 'Only a SuperAdmin can act on staff accounts.'; end if;
  return t;
end $$;

create or replace function public.admin_moderate(p_id uuid, p_status text, p_reason text default '', p_days int default null) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles;
begin
  if p_status not in ('active','suspended','banned') then raise exception 'Bad status'; end if;
  if p_id = me.id then raise exception 'You cannot change your own status.'; end if;
  t := public._admin_target(me, p_id);
  if p_days is not null and (p_days < 1 or p_days > 365) then raise exception 'Suspensions last 1–365 days.'; end if;
  update public.profiles set status = p_status,
    status_reason = case when p_status = 'active' then null else nullif(left(trim(coalesce(p_reason, '')), 200), '') end,
    suspended_until = case when p_status = 'suspended' and p_days is not null then now() + make_interval(days => p_days) end
  where id = p_id;
  perform public._audit(me.id, case p_status when 'active' then 'reinstate' when 'banned' then 'ban' else 'suspend' end, p_id::text,
    jsonb_strip_nulls(jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''), 'days', p_days)));
end $$;

-- Kept for older clients.
create or replace function public.admin_set_status(p_id uuid, p_status text, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin perform public.admin_moderate(p_id, p_status, p_reason, null); end $$;

create or replace function public.admin_warn(p_id uuid, p_message text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles; msg text := nullif(left(trim(coalesce(p_message, '')), 500), '');
begin
  if msg is null then raise exception 'Write the warning message.'; end if;
  if p_id = me.id then raise exception 'You cannot warn yourself.'; end if;
  t := public._admin_target(me, p_id);
  update public.profiles set notice = msg, notice_at = now() where id = p_id;
  perform public._audit(me.id, 'warn', p_id::text, jsonb_build_object('message', msg));
end $$;

create or replace function public.admin_handle_report(p_id uuid, p_action text, p_note text default '', p_days int default null) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); r public.reports; note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_action not in ('dismiss','warn','suspend','ban') then raise exception 'Bad action'; end if;
  select * into r from public.reports where id = p_id for update;
  if r.id is null then raise exception 'Report not found'; end if;
  if r.status <> 'open' then raise exception 'This report has already been handled.'; end if;
  if p_action = 'warn' then
    perform public.admin_warn(r.target, coalesce(note, 'We received a report about your activity (' || r.reason || '). Please follow our community guidelines — further reports can lead to suspension.'));
  elsif p_action = 'suspend' then
    perform public.admin_moderate(r.target, 'suspended', 'Report: ' || r.reason, coalesce(p_days, 7));
  elsif p_action = 'ban' then
    perform public.admin_moderate(r.target, 'banned', 'Report: ' || r.reason, null);
    update public.reports set status = 'actioned', resolution = 'ban', handled_by = me.id, handled_at = now()
      where target = r.target and status = 'open' and id <> r.id;
  end if;
  update public.reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end, resolution = p_action, handled_by = me.id, handled_at = now() where id = p_id;
  perform public._audit(me.id, 'resolve_report', r.target::text, jsonb_strip_nulls(jsonb_build_object('action', p_action, 'reportId', p_id, 'note', note, 'days', p_days)));
end $$;

create or replace function public.admin_resolve_report(p_id uuid, p_action text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin perform public.admin_handle_report(p_id, p_action, p_note, null); end $$;

create or replace function public.admin_decide_verification(p_id uuid, p_approve boolean) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles;
begin
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.verification_status <> 'pending' then raise exception 'This verification was already decided.'; end if;
  update public.profiles set verification_status = case when p_approve then 'approved' else 'rejected' end, verified = p_approve where id = p_id;
  perform public._recalc(p_id);
  perform public._audit(me.id, case when p_approve then 'verify_approve' else 'verify_reject' end, p_id::text);
end $$;

-- ─────────── Members ───────────
create or replace function public._admin_row(p public.profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason,
    'suspendedUntil', p.suspended_until, 'createdAt', p.created_at, 'lastActive', p.last_active,
    'openReports', (select count(*) from public.reports r where r.target = p.id and r.status = 'open'),
    'profile', public._pub(p) || jsonb_build_object('firstName', p.name, 'lastName', p.last_name, 'verificationStatus', p.verification_status))
$$;

create or replace function public.admin_members(p_q text default '', p_filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff(); q text := '%' || lower(coalesce(trim(p_q), '')) || '%';
begin
  if p_filter not in ('all','active','suspended','banned','staff','pending','verified','unverified','reported') then raise exception 'Bad filter'; end if;
  return coalesce((select jsonb_agg(public._admin_row(p) order by p.created_at desc) from (
    select * from public.profiles x
    where (lower(coalesce(x.email,'')) like q or lower(coalesce(x.name,'')) like q or lower(coalesce(x.last_name,'')) like q
           or lower(coalesce(x.username,'')) like q or lower(coalesce(x.city,'')) like q or lower(coalesce(x.country,'')) like q)
      and case p_filter
            when 'active' then x.status = 'active' when 'suspended' then x.status = 'suspended' when 'banned' then x.status = 'banned'
            when 'staff' then x.role <> 'user' when 'pending' then x.verification_status = 'pending'
            when 'verified' then x.verified when 'unverified' then not x.verified and x.role = 'user'
            when 'reported' then exists (select 1 from public.reports r where r.target = x.id and r.status = 'open')
            else true end
    order by x.created_at desc limit 500) p), '[]');
end $$;

create or replace function public.admin_member(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff(); p public.profiles;
begin
  select * into p from public.profiles where id = p_id;
  if p.id is null then raise exception 'User not found'; end if;
  return public._pub(p) || jsonb_build_object(
    'firstName', p.name, 'lastName', p.last_name, 'email', p.email, 'role', p.role, 'status', p.status, 'statusReason', p.status_reason,
    'suspendedUntil', p.suspended_until, 'verificationStatus', p.verification_status, 'onboarded', p.onboarded, 'paused', p.paused,
    'notice', p.notice, 'noticeAt', p.notice_at,
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
      from (select * from public.audit_log where target = p.id::text order by at desc limit 30) a left join public.profiles pa on pa.id = a.actor), '[]'));
end $$;

create or replace function public.admin_edit_member(p_id uuid, p_action text, p_index int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._staff(); t public.profiles; removed text;
begin
  t := public._admin_target(me, p_id);
  if p_action = 'remove_photo' then
    if p_index is null or p_index < 0 or p_index >= coalesce(cardinality(t.photos), 0) then raise exception 'Photo not found'; end if;
    removed := t.photos[p_index + 1];
    update public.profiles set photos = t.photos[1:p_index] || t.photos[p_index + 2:] where id = p_id;
  elsif p_action = 'clear_bio' then update public.profiles set bio = null where id = p_id;
  elsif p_action = 'clear_prompts' then update public.profiles set prompts = '[]' where id = p_id;
  elsif p_action = 'clear_voice' then removed := t.voice_url; update public.profiles set voice_url = null where id = p_id;
  elsif p_action = 'revoke_verification' then
    update public.profiles set verified = false, verification_status = 'none', verification_selfie = null where id = p_id;
  else raise exception 'Bad action'; end if;
  perform public._recalc(p_id);
  perform public._audit(me.id, 'edit_member', p_id::text, jsonb_strip_nulls(jsonb_build_object('action', p_action, 'index', p_index)));
  return jsonb_build_object('removed', removed);
end $$;

-- ─────────── SuperAdmin ───────────
create or replace function public.admin_user_media(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare me public.profiles := public._staff('superadmin');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name))
    from storage.objects o where o.owner = p_id and o.bucket_id in ('photos', 'voice', 'verifications')), '[]');
end $$;

create or replace function public.super_delete_user(p_id uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare me public.profiles := public._staff('superadmin'); t public.profiles;
begin
  if p_id = me.id then raise exception 'You cannot delete your own account from the console.'; end if;
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role = 'superadmin' then raise exception 'Remove the SuperAdmin role before deleting this account.'; end if;
  perform public._audit(me.id, 'delete_user', p_id::text, jsonb_strip_nulls(jsonb_build_object('email', t.email, 'username', t.username)));
  delete from auth.users where id = p_id; -- cascades to profile, swipes, matches, messages, answers, reports
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
    'signupsOpen', coalesce((p->>'signupsOpen')::boolean, (cur->>'signupsOpen')::boolean, true),
    'announcement', left(coalesce(p->>'announcement', cur->>'announcement', ''), 280));
  update public.app_settings set data = n where id = 1;
  perform public._audit(me.id, 'save_settings', 'app', n);
  return n;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_user text := nullif(lower(trim(m->>'username')), '');
  v_gender text := case when m->>'gender' in ('woman', 'man') then m->>'gender' end;
  v_dob date;
  min_age int := coalesce((public._settings()->>'minAge')::int, 18);
begin
  if not coalesce((public._settings()->>'signupsOpen')::boolean, true) then
    raise exception 'New sign-ups are paused right now. Please try again later.';
  end if;
  begin v_dob := nullif(m->>'dob', '')::date; exception when others then v_dob := null; end;
  if v_dob is not null and public._age(v_dob) < min_age then
    raise exception 'You must be %+ to use Sierra Leone Connect.', min_age;
  end if;
  if v_user is not null and not public.username_available(v_user) then
    raise exception 'That username is taken or invalid.';
  end if;
  insert into public.profiles (id, email, name, last_name, username, gender, dob, country, city, lat, lng, prefs)
  values (new.id, lower(new.email),
    nullif(left(trim(m->>'first_name'), 30), ''), nullif(left(trim(m->>'last_name'), 40), ''), v_user, v_gender, v_dob,
    nullif(left(trim(m->>'country'), 60), ''), nullif(left(trim(m->>'city'), 60), ''),
    round((nullif(m->>'lat', ''))::numeric, 2)::double precision, round((nullif(m->>'lng', ''))::numeric, 2)::double precision,
    case v_gender when 'man' then '{"seeking":["woman"]}'::jsonb when 'woman' then '{"seeking":["man"]}'::jsonb else '{}'::jsonb end)
  on conflict (id) do nothing;
  insert into public.audit_log (actor, action, target) values (new.id, 'signup', new.id::text);
  return new;
end $$;

create or replace function public.admin_stats() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff();
begin
  return jsonb_build_object(
    'users', (select count(*) from public.profiles where role = 'user'),
    'active24h', (select count(*) from public.profiles where role = 'user' and last_active > now() - interval '1 day'),
    'newToday', (select count(*) from public.profiles where role = 'user' and created_at > now() - interval '1 day'),
    'new7d', (select count(*) from public.profiles where role = 'user' and created_at > now() - interval '7 days'),
    'matches', (select count(*) from public.matches where unmatched_at is null),
    'messages', (select count(*) from public.messages),
    'openReports', (select count(*) from public.reports where status = 'open'),
    'pendingVerifications', (select count(*) from public.profiles where verification_status = 'pending'),
    'flagged', (select count(*) from public.messages where array_length(flagged,1) > 0 and not cleared),
    'suspended', (select count(*) from public.profiles where status = 'suspended'),
    'banned', (select count(*) from public.profiles where status = 'banned'));
end $$;

create or replace function public.super_analytics() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._staff('superadmin');
begin
  return (with d as (select generate_series(current_date - 13, current_date, interval '1 day')::date as day)
    select jsonb_build_object(
      'days', (select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day) from d),
      'signups', (select jsonb_agg((select count(*) from public.profiles where role = 'user' and created_at::date = d.day) order by d.day) from d),
      'matches', (select jsonb_agg((select count(*) from public.matches where created_at::date = d.day) order by d.day) from d),
      'messages', (select jsonb_agg((select count(*) from public.messages where created_at::date = d.day) order by d.day) from d),
      'likes', (select jsonb_agg((select count(*) from public.swipes where kind <> 'pass' and created_at::date = d.day) order by d.day) from d),
      'byCountry', coalesce((select jsonb_object_agg(country, n) from (select country, count(*) n from public.profiles where country is not null and role = 'user' group by country) c), '{}'),
      'byIntent', coalesce((select jsonb_object_agg(intent, n) from (select intent, count(*) n from public.profiles where intent is not null and role = 'user' group by intent) c), '{}'),
      'byGender', coalesce((select jsonb_object_agg(gender, n) from (select gender, count(*) n from public.profiles where gender is not null and role = 'user' group by gender) c), '{}'),
      'totals', jsonb_build_object(
        'members', (select count(*) from public.profiles where role = 'user'),
        'onboarded', (select count(*) from public.profiles where role = 'user' and onboarded),
        'verified', (select count(*) from public.profiles where role = 'user' and verified),
        'likes', (select count(*) from public.swipes where kind <> 'pass'),
        'matches', (select count(*) from public.matches),
        'conversations', (select count(distinct match_id) from public.messages))));
end $$;

-- New functions start out executable by PUBLIC (per-schema default privileges can't remove that), so lock them
-- down explicitly — including _eligible from slc_13 — then grant the API ones to signed-in users only.
revoke execute on function
  public._eligible(public.profiles, public.profiles), public._is_staff(text), public._admin_target(public.profiles, uuid), public._admin_row(public.profiles),
  public.ack_notice(), public.admin_moderate(uuid, text, text, int), public.admin_warn(uuid, text),
  public.admin_handle_report(uuid, text, text, int), public.admin_members(text, text), public.admin_member(uuid),
  public.admin_edit_member(uuid, text, int), public.admin_user_media(uuid), public.super_delete_user(uuid)
from public, anon, authenticated;
grant execute on function
  public.ack_notice(), public.admin_moderate(uuid, text, text, int), public.admin_warn(uuid, text),
  public.admin_handle_report(uuid, text, text, int), public.admin_members(text, text), public.admin_member(uuid),
  public.admin_edit_member(uuid, text, int), public.admin_user_media(uuid), public.super_delete_user(uuid), public._is_staff(text)
to authenticated;
