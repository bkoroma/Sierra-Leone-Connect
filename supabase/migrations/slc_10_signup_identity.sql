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
