-- Read-only flag so the app can offer re-verification for originals attached before the S3 gate.
-- Mirrors private.invoice_has_verified_s3, scoped to one document and to the caller's own invoices.
create function public.storage_verified(public.invoice_documents) returns boolean
language sql stable security definer set search_path='' as $$
 select exists (
 select 1 from private.invoice_s3_confirmations c
 join storage.objects o on o.id=c.object_id and o.bucket_id='invoice-documents' and o.name=$1.storage_path
 join public.invoices i on i.id=$1.invoice_id
 where c.document_id=$1.id
 and private.is_org_member(i.organization_id) and private.can_location(i.location_id)
 and split_part($1.storage_path,'/',1)=i.organization_id::text
 and split_part($1.storage_path,'/',2)=i.id::text
 and private.is_invoice_document_canonical_path($1.storage_path)
 and o.version is not distinct from c.object_version
 and o.updated_at=c.object_updated_at
 and coalesce(o.is_delete_marker,false)=false and o.archived_at is null
 and (o.metadata->>'size')::bigint=c.byte_size
 and trim(both '"' from o.metadata->>'eTag')=c.etag
 );
$$;
revoke all on function public.storage_verified(public.invoice_documents) from public,anon;
grant execute on function public.storage_verified(public.invoice_documents) to authenticated,service_role;
