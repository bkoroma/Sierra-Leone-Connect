-- Sierra Leone Connect — storage access for staff moderation and owner clean-up.
-- Removing a file through the Storage API needs both SELECT and DELETE on the object.

-- Photos (and profile voice intros, which live in the photos bucket): owners and staff can read rows; staff can delete.
drop policy if exists "photos select own or staff" on storage.objects;
create policy "photos select own or staff" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public._is_staff('admin')));
drop policy if exists "photos delete staff" on storage.objects;
create policy "photos delete staff" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public._is_staff('admin'));

-- Verification selfies: owner, or staff who passed 2FA (when required).
drop policy if exists "verifications read" on storage.objects;
create policy "verifications read" on storage.objects for select to authenticated
  using (bucket_id = 'verifications' and ((storage.foldername(name))[1] = auth.uid()::text or public._is_staff('admin')));

-- Voice notes: match members, the uploader, and SuperAdmins (account deletion).
drop policy if exists "voice read member" on storage.objects;
create policy "voice read member" on storage.objects for select to authenticated
  using (bucket_id = 'voice' and (public._is_member_txt((storage.foldername(name))[1]) or owner = auth.uid() or public._is_staff('superadmin')));

-- SuperAdmin account deletion removes every upload of that member.
drop policy if exists "super delete media" on storage.objects;
create policy "super delete media" on storage.objects for delete to authenticated
  using (bucket_id in ('voice', 'verifications') and public._is_staff('superadmin'));
