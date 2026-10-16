-- Careers: storage policies for careers-uploads now require the same MFA assurance as
-- the careers_* table policies, so an owner/admin password alone cannot list or fetch
-- résumés and selfies straight from the Storage API.
drop policy if exists careers_uploads_select on storage.objects;
drop policy if exists careers_uploads_delete on storage.objects;
create policy careers_uploads_select on storage.objects for select to authenticated
 using (bucket_id = 'careers-uploads' and private.mfa_authorized() and exists (
  select 1 from public.careers_applications a
  where a.id::text = (storage.foldername(objects.name))[2] and a.organization_id::text = (storage.foldername(objects.name))[1]
   and private.has_org_role(a.organization_id, array['owner','admin']::public.member_role[])));
create policy careers_uploads_delete on storage.objects for delete to authenticated
 using (bucket_id = 'careers-uploads' and private.mfa_authorized() and exists (
  select 1 from public.careers_applications a
  where a.id::text = (storage.foldername(objects.name))[2] and a.organization_id::text = (storage.foldername(objects.name))[1]
   and private.has_org_role(a.organization_id, array['owner','admin']::public.member_role[])));
