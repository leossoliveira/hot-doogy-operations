drop policy if exists invoice_documents_insert on storage.objects;
create policy invoice_documents_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'invoice-documents'
  and private.is_invoice_document_canonical_path(name)
  and exists (
    select 1 from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

drop policy if exists invoice_documents_update on storage.objects;
create policy invoice_documents_update on storage.objects
for update to authenticated
using (
  bucket_id = 'invoice-documents'
  and private.is_invoice_document_canonical_path(name)
  and exists (
    select 1 from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  bucket_id = 'invoice-documents'
  and private.is_invoice_document_canonical_path(name)
  and exists (
    select 1 from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);
;
