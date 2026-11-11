-- Moderators delete a verification selfie as soon as they approve or reject it (data minimisation).
drop policy if exists "verifications delete staff" on storage.objects;
create policy "verifications delete staff" on storage.objects for delete to authenticated
  using (bucket_id = 'verifications' and public._is_staff('admin'));
