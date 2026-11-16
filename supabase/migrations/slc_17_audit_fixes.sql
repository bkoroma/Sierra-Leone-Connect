-- Sierra Leone Connect — code audit fixes (v1.7)
-- • Account deletion: banned members' photos were left behind (the media list used a check that rejects banned
--   accounts). The list no longer does, and it refuses up front when the account can't be deleted, so files are
--   never erased for an account that then stays.
-- • Unmatch is final for the other person: they can no longer force the match back by liking again, and the
--   conversation can't be read after an unmatch or block.
-- • Banned members lose direct read access to chats.
-- • Reports: one open report per reporter and member (repeats update it), clean errors for missing members.
-- • Usernames that impersonate staff or the brand (admin, support, slconnect…) are reserved.
-- • Profile photos / voice intro must be files the member uploaded to our own storage.
-- • Storage rules work with both owner columns Supabase keeps on files.

-- ─────────── Helpers ───────────
-- True when `u` is a public URL of a file in the member's own folder of the photos bucket.
-- The project's address comes from the signed sign-in token (iss), so links to other servers are refused.
create or replace function public._own_media(u text, p_uid uuid, p_ext text) returns boolean language plpgsql stable set search_path = public as $$
declare iss text := coalesce(auth.jwt()->>'iss', ''); base text; tail text := '/storage/v1/object/public/photos/' || p_uid::text || '/';
begin
  if u is null or u !~ '^https://' then return false; end if;
  if iss ~ '^https://[^/]+/auth/v1/?$' then
    base := regexp_replace(iss, '/auth/v1/?$', '') || tail;
    return left(u, length(base)) = base and substr(u, length(base) + 1) ~ ('^[A-Za-z0-9-]+\.(' || p_ext || ')$');
  end if;
  return u ~ ('^https://[a-z0-9.-]+' || tail || '[A-Za-z0-9-]+\.(' || p_ext || ')$');
end $$;

create or replace function public._reserved_username(p text) returns boolean language sql immutable set search_path = public as $$
  select regexp_replace(lower(coalesce(p, '')), '[._]', '', 'g') ~ '^(slconnect|sierraleoneconnect|salonecon+ect|admin|superadmin|support|moderator|official|helpdesk|customerservice|customercare)'
      or regexp_replace(lower(coalesce(p, '')), '[._]', '', 'g') in ('mod','mods','staff','team','help','safety','security','system','root','owner','null','undefined','member','deleted','deletedmember','everyone','anonymous','slc')
$$;

create or replace function public.username_available(p_username text) returns boolean language sql stable security definer set search_path = public as $$
  select lower(trim(p_username)) ~ '^[a-z0-9._]{3,20}$'
     and lower(trim(p_username)) !~ '^[._]' and lower(trim(p_username)) !~ '[._]$' and lower(trim(p_username)) !~ '[._]{2}'
     and not public._reserved_username(trim(p_username))
     and not exists (select 1 from public.profiles where lower(username) = lower(trim(p_username)))
$$;

-- Chats are readable only by active (not banned / currently suspended) members of a live match.
create or replace function public._is_member(p_match uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matches m where m.id = p_match and m.unmatched_at is null and auth.uid() in (m.user_a, m.user_b))
     and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.status = 'active' or (p.status = 'suspended' and p.suspended_until <= now())))
$$;

-- ─────────── Chat & safety ───────────
create or replace function public.get_messages(p_match uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); m public.matches; other uuid;
begin
  select * into m from public.matches where id = p_match and me.id in (user_a, user_b) and unmatched_at is null;
  if m.id is null then raise exception 'Conversation not found.'; end if;
  other := case when m.user_a = me.id then m.user_b else m.user_a end;
  if public._blocked(me.id, other) then raise exception 'Conversation not found.'; end if;
  if m.user_a = me.id then update public.matches set read_a = now() where id = m.id; else update public.matches set read_b = now() where id = m.id; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public._msg(x) order by x.created_at)
      from (select * from public.messages where match_id = m.id order by created_at desc limit 500) x), '[]'),
    'otherReadAt', case when m.user_a = me.id then m.read_b else m.read_a end);
end $$;

-- Unmatching also turns my like into a pass, so the other person can't bring the match back by liking again.
create or replace function public.unmatch(p_match uuid) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); m public.matches; other uuid;
begin
  select * into m from public.matches where id = p_match and me.id in (user_a, user_b) for update;
  if m.id is null then return; end if;
  other := case when m.user_a = me.id then m.user_b else m.user_a end;
  update public.matches set unmatched_at = coalesce(unmatched_at, now()) where id = m.id;
  insert into public.swipes (swiper, target, kind) values (me.id, other, 'pass')
    on conflict (swiper, target) do update set kind = 'pass', comment = '', ref = '', created_at = now();
end $$;

create or replace function public.block_user(p_target uuid) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  if p_target = me.id then return; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'This profile is no longer available.'; end if;
  insert into public.blocks (blocker, blocked) values (me.id, p_target) on conflict do nothing;
  update public.matches set unmatched_at = coalesce(unmatched_at, now()) where user_a = least(me.id, p_target) and user_b = greatest(me.id, p_target);
  update public.swipes set kind = 'pass', comment = '', ref = '', created_at = now() where swiper = me.id and target = p_target;
end $$;

create or replace function public.report_user(p_target uuid, p_reason text, p_details text default '', p_message uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); v_reason text := nullif(left(trim(coalesce(p_reason, '')), 80), ''); v_details text := left(coalesce(p_details, ''), 1000);
  v_msg uuid := (select id from public.messages x where x.id = p_message and x.sender = p_target); r public.reports;
begin
  if p_target = me.id then raise exception 'You cannot report yourself.'; end if;
  if v_reason is null then raise exception 'Choose a reason for the report.'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'This profile is no longer available.'; end if;
  -- A second report about the same member while the first is still open updates it instead of flooding the queue.
  select * into r from public.reports where reporter = me.id and target = p_target and status = 'open' order by created_at desc limit 1 for update;
  if r.id is not null then
    update public.reports set reason = v_reason, details = case when v_details <> '' then v_details else details end,
      message_id = coalesce(v_msg, message_id) where id = r.id;
    return;
  end if;
  if (select count(*) from public.reports where reporter = me.id and created_at > now() - interval '1 day') >= 20 then raise exception 'Report limit reached for today.'; end if;
  insert into public.reports (reporter, target, reason, details, message_id) values (me.id, p_target, v_reason, v_details, v_msg);
end $$;

-- ─────────── Profile ───────────
create or replace function public.save_profile(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); min_age int := coalesce((public._settings()->>'minAge')::int, 18);
begin
  if p ? 'dob' and p->>'dob' is not null and public._age((p->>'dob')::date) < min_age then
    raise exception 'You must be %+ to use Sierra Leone Connect.', min_age;
  end if;
  -- Photos and the voice intro must be files this member uploaded to our own storage (no outside or other people's links).
  if p ? 'photos' and exists (select 1 from jsonb_array_elements_text(p->'photos') u where not public._own_media(u, me.id, 'jpg|jpeg|png|webp')) then
    raise exception 'Invalid photo URL.';
  end if;
  if p ? 'voice' and p->>'voice' is not null and not public._own_media(p->>'voice', me.id, 'webm|m4a|mp4|ogg') then raise exception 'Invalid voice URL.'; end if;
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
      'ageMin', greatest(18, least(99, coalesce((p->'prefs'->>'ageMin')::int, greatest(18, coalesce(public._age(coalesce(nullif(p->>'dob','')::date, me.dob)), 30) - 8)))),
      'ageMax', greatest(18, least(99, coalesce((p->'prefs'->>'ageMax')::int, least(80, greatest(coalesce(public._age(coalesce(nullif(p->>'dob','')::date, me.dob)), 30) + 10, 25))))),
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

-- ─────────── Account deletion ───────────
-- Lists the caller's uploads so the app can erase them before the account. Works for banned and suspended
-- members too (right to erasure), and refuses first if the account can't be deleted.
create or replace function public.my_media() returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Please log in again.'; end if;
  if me.role = 'superadmin' and not exists (select 1 from public.profiles where role = 'superadmin' and status = 'active' and id <> me.id) then
    raise exception 'You are the only SuperAdmin. Make another member SuperAdmin before deleting this account.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name))
    from storage.objects o where o.bucket_id in ('photos', 'voice', 'verifications')
      and (o.owner = me.id or o.owner_id = me.id::text or (o.bucket_id <> 'voice' and (storage.foldername(o.name))[1] = me.id::text))), '[]');
end $$;

create or replace function public.admin_user_media(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare me public.profiles := public._staff('superadmin'); t public.profiles;
begin
  if p_id = me.id then raise exception 'You cannot delete your own account from the console.'; end if;
  select * into t from public.profiles where id = p_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role = 'superadmin' then raise exception 'Remove the SuperAdmin role before deleting this account.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name))
    from storage.objects o where o.bucket_id in ('photos', 'voice', 'verifications')
      and (o.owner = p_id or o.owner_id = p_id::text or (o.bucket_id <> 'voice' and (storage.foldername(o.name))[1] = p_id::text))), '[]');
end $$;

create or replace function public._schema_version() returns int language sql immutable set search_path = public as $$ select 17 $$;

revoke execute on function public._own_media(text, uuid, text), public._reserved_username(text) from public, anon, authenticated;
