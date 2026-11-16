-- Storage rules accept either owner column Supabase keeps on files (owner / owner_id), so members can
-- always read and delete their own voice notes and selfies.
drop policy if exists "voice delete own" on storage.objects;
create policy "voice delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (owner = auth.uid() or owner_id = auth.uid()::text));
drop policy if exists "verifications delete own" on storage.objects;
create policy "verifications delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'verifications' and ((storage.foldername(name))[1] = auth.uid()::text or owner = auth.uid() or owner_id = auth.uid()::text));
drop policy if exists "voice read member" on storage.objects;
create policy "voice read member" on storage.objects for select to authenticated
  using (bucket_id = 'voice' and (public._is_member_txt((storage.foldername(name))[1]) or owner = auth.uid() or owner_id = auth.uid()::text or public._is_staff('superadmin')));
