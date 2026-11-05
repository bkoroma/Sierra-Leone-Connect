-- Sierra Leone Connect — gender chosen at sign-up is saved by the sign-up trigger.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_user text := nullif(lower(trim(m->>'username')), '');
  v_gender text := case when m->>'gender' in ('woman', 'man') then m->>'gender' end;
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
