-- Sierra Leone Connect — matching audit fixes
-- 1) One shared eligibility rule (deck, Likes You, swipe) so they can't drift apart.
-- 2) Likes obey the same filters as the deck (direct API calls can't bypass them).
-- 3) Pair-level lock in swipe: two people liking each other at the same moment always get their match.
-- 4) Default age window follows the member's own age (8 younger … 10 older), same as the app.
-- 5) Passed profiles come back after 30 days.
-- 6) save_profile stores the same age-relative default when no age range is sent.
create or replace function public._seeks(a public.profiles, b public.profiles) returns boolean language sql stable set search_path = public as $$
  select (jsonb_array_length(coalesce(a.prefs->'seeking','[]')) = 0 or (a.prefs->'seeking') ? b.gender)
     and public._age(b.dob) between coalesce((a.prefs->>'ageMin')::int, greatest(18, coalesce(public._age(a.dob), 30) - 8))
                               and coalesce((a.prefs->>'ageMax')::int, least(80, greatest(coalesce(public._age(a.dob), 30) + 10, 25)))
$$;

create or replace function public._eligible(me public.profiles, p public.profiles) returns boolean language sql stable security definer set search_path = public as $$
  select p.id <> me.id and p.status = 'active' and p.onboarded and not p.paused and p.role = 'user'
     and public._age(p.dob) >= 18
     and not public._blocked(me.id, p.id)
     and public._seeks(me, p) and public._seeks(p, me)
     and (not coalesce((me.prefs->>'faithMatters')::boolean, false) or p.faith is null or me.faith is null or p.faith = me.faith or p.faith = 'Prefer not to say')
     and (not coalesce((me.prefs->>'sameIntentOnly')::boolean, false) or p.intent = me.intent)
     and not coalesce((public._qmatch(me.id, p.id)->>'deal')::boolean, false)
$$;

create or replace function public.get_deck(p_mode text default 'worldwide') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me(); res jsonb;
begin
  with base as (
    select p as prof, p.id, p.last_active, public._qmatch(me.id, p.id) as qm from public.profiles p
    where p.id <> me.id and p.status = 'active' and p.onboarded and not p.paused and p.role = 'user'
      and public._age(p.dob) >= 18
      and not exists (select 1 from public.swipes s where s.swiper = me.id and s.target = p.id and (s.kind <> 'pass' or s.created_at > now() - interval '30 days')) -- passes come back after 30 days
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

create or replace function public.likes_you() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  return coalesce((select jsonb_agg(public._pub(p) || jsonb_build_object('superLiked', s.kind = 'super', 'comment', s.comment, 'ref', s.ref, 'q', public._qmatch(me.id, p.id)) order by s.kind = 'super' desc, s.comment <> '' desc, s.created_at desc)
    from public.swipes s join public.profiles p on p.id = s.swiper
    where s.target = me.id and s.kind <> 'pass'
      and not exists (select 1 from public.swipes x where x.swiper = me.id and x.target = p.id and (x.kind <> 'pass' or x.created_at > now() - interval '30 days'))
      and public._eligible(me, p)), '[]');
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
  if p_kind <> 'pass' and not public._eligible(me, t) then raise exception 'This profile is no longer available.'; end if;
  perform pg_advisory_xact_lock(hashtext(me.id::text));                                              -- serialises my quota
  perform pg_advisory_xact_lock(hashtext(least(me.id, t.id)::text || greatest(me.id, t.id)::text)); -- serialises the pair: no missed matches
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
