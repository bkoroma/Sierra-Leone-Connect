-- ════════════════════════════════════════════════════════════════════════════
-- Sierra Leone Connect — FINAL SECURITY STEP (run once, before launch)
-- Supabase Dashboard → project "Sierra Leone Connect" → SQL Editor → New query
-- → paste this whole file → Run. Safe to run more than once.
--
-- What it does:
--  • Creates 3 member functions that delete data (undo swipe, remove answer,
--    delete account) — the connector needs your approval for these.
--  • Removes direct table access for anon/authenticated (everything goes
--    through checked RPCs; messages stay readable by match members for chat).
--  • Revokes EXECUTE on every function, then grants back ONLY the app's API
--    to signed-in users. Internal helpers (_audit, _qmatch, _full …) become
--    uncallable from the outside.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.remove_answer(p_qid text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._me();
begin
  delete from public.answers where user_id = me.id and qid = p_qid;
  perform public._recalc(me.id);
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

create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$
declare me public.profiles := public._me();
begin
  insert into public.audit_log (actor, action, target) values (me.id, 'account_deleted', me.id::text);
  delete from auth.users where id = me.id; -- cascades to profile, answers, swipes, matches, messages
end $$;

revoke all on public.profiles, public.swipes, public.matches, public.messages, public.blocks, public.reports,
  public.app_settings, public.audit_log, public.questions, public.answers, public.tot_pairs from anon, authenticated;
grant select on public.messages to authenticated; -- filtered by RLS policy messages_members_read

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_settings() to anon, authenticated;
grant execute on function public._is_member(uuid), public._is_member_txt(text) to authenticated; -- used by RLS/storage policies
grant execute on function public.my_media() to authenticated; -- lets the app erase a member's own uploads on account deletion
grant execute on function
  public.my_session(), public.get_me(), public.save_profile(jsonb), public.request_verification(text), public.quota(),
  public.get_deck(text), public.swipe(uuid, text, text, text), public.undo_swipe(), public.likes_you(), public.my_matches(),
  public.get_messages(uuid), public.send_message(uuid, text, text, text, jsonb), public.unmatch(uuid),
  public.save_answer(text, int, int[], int, boolean), public.remove_answer(text), public.extend_match(uuid),
  public.report_user(uuid, text, text, uuid), public.block_user(uuid), public.touch_streak(), public.delete_account(),
  public.admin_stats(), public.admin_users(text), public.admin_set_status(uuid, text, text), public.admin_reports(text),
  public.admin_resolve_report(uuid, text, text), public.admin_verifications(), public.admin_decide_verification(uuid, boolean),
  public.admin_flagged(), public.admin_clear_flag(uuid), public.super_set_role(uuid, text), public.super_save_settings(jsonb),
  public.super_audit(), public.super_analytics()
to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Quick self-check: every row should say true.
select
  not has_function_privilege('anon', 'public._audit(uuid,text,text,jsonb)', 'execute')          as helpers_locked_anon,
  not has_function_privilege('authenticated', 'public._qmatch(uuid,uuid)', 'execute')           as helpers_locked_auth,
  not has_table_privilege('anon', 'public.profiles', 'select')                                  as tables_locked,
  has_function_privilege('authenticated', 'public.get_deck(text)', 'execute')                   as api_open_to_members,
  not has_function_privilege('anon', 'public.get_deck(text)', 'execute')                        as api_closed_to_anon,
  has_function_privilege('anon', 'public.get_settings()', 'execute')                            as settings_public;
