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
