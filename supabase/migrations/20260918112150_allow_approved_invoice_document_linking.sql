drop policy if exists rm2_invoice_document_insert on public.invoice_documents;
create policy rm2_invoice_document_insert on public.invoice_documents
for insert to authenticated
with check (
  private.is_invoice_document_canonical_path(storage_path)
  and exists (
    select 1 from public.invoices i
    where i.id = invoice_documents.invoice_id
      and i.status in ('uploaded'::public.invoice_status, 'processing'::public.invoice_status, 'review'::public.invoice_status, 'approved'::public.invoice_status)
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

drop policy if exists rm2_invoice_document_update on public.invoice_documents;
create policy rm2_invoice_document_update on public.invoice_documents
for update to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_documents.invoice_id
      and i.status in ('uploaded'::public.invoice_status, 'processing'::public.invoice_status, 'review'::public.invoice_status, 'approved'::public.invoice_status)
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  private.is_invoice_document_canonical_path(storage_path)
  and exists (
    select 1 from public.invoices i
    where i.id = invoice_documents.invoice_id
      and i.status in ('uploaded'::public.invoice_status, 'processing'::public.invoice_status, 'review'::public.invoice_status, 'approved'::public.invoice_status)
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);
;
