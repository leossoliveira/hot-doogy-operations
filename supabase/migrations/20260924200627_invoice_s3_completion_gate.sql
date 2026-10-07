
-- S3 confirmation is an attestation from the trusted upload backend, never the client.
create table private.invoice_s3_confirmations (
 document_id uuid primary key references public.invoice_documents(id) on delete cascade,
 object_id uuid not null, object_version text, object_updated_at timestamptz not null,
 etag text not null, byte_size bigint not null check(byte_size>0),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 verified_at timestamptz not null default now()
);
revoke all on private.invoice_s3_confirmations from public,anon,authenticated,service_role;

create function private.invoice_has_verified_s3(p_invoice uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists (
 select 1 from public.invoice_documents d
 join private.invoice_s3_confirmations c on c.document_id=d.id
 join storage.objects o on o.id=c.object_id and o.bucket_id='invoice-documents' and o.name=d.storage_path
 join public.invoices i on i.id=d.invoice_id
 where d.invoice_id=p_invoice
 and split_part(d.storage_path,'/',1)=i.organization_id::text
 and split_part(d.storage_path,'/',2)=i.id::text
 and private.is_invoice_document_canonical_path(d.storage_path)
 and o.version is not distinct from c.object_version
 and o.updated_at=c.object_updated_at
 and coalesce(o.is_delete_marker,false)=false and o.archived_at is null
 and (o.metadata->>'size')::bigint=c.byte_size
 and trim(both '"' from o.metadata->>'eTag')=c.etag
 );
$$;
revoke all on function private.invoice_has_verified_s3(uuid) from public,anon,authenticated,service_role;

create function private.enforce_invoice_s3() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('approved','paid') then
  if TG_OP='INSERT' then
   raise exception 'INVOICE_S3_REQUIRED: create an uploaded invoice, store the original via S3, then approve';
  end if;
  if new.status is distinct from old.status
    or new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.invoice_number is distinct from old.invoice_number
    or new.invoice_date is distinct from old.invoice_date then
   if not private.invoice_has_verified_s3(new.id) then
    raise exception 'INVOICE_S3_REQUIRED: original file must be uploaded and verified via S3 before approval/payment';
   end if;
   -- Identity changes require re-verification under a new canonical path.
   if new.organization_id is distinct from old.organization_id or new.location_id is distinct from old.location_id
     or new.invoice_number is distinct from old.invoice_number or new.invoice_date is distinct from old.invoice_date then
    raise exception 'INVOICE_S3_IDENTITY_CHANGED: return to review and reverify the document before approving';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.enforce_invoice_s3() from public,anon,authenticated,service_role;
create trigger invoice_s3_completion_guard before insert or update on public.invoices
for each row execute function private.enforce_invoice_s3();

create function private.guard_verified_invoice_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.invoices where id=old.invoice_id for update;
 if exists(select 1 from private.invoice_s3_confirmations where document_id=old.id)
 and exists(select 1 from public.invoices where id=old.invoice_id and status in ('approved','paid')) then
  if TG_OP='DELETE' then raise exception 'Verified original cannot be removed from a completed invoice'; end if;
  if new.storage_path is distinct from old.storage_path or new.invoice_id is distinct from old.invoice_id then
   raise exception 'Verified original cannot be replaced on a completed invoice';
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if; return new;
end $$;
revoke all on function private.guard_verified_invoice_document() from public,anon,authenticated,service_role;
create trigger invoice_s3_document_guard before update or delete on public.invoice_documents
for each row execute function private.guard_verified_invoice_document();

create function public.confirm_invoice_s3_document(
 p_invoice uuid,p_path text,p_file_name text,p_mime_type text,
 p_size bigint,p_etag text,p_sha256 text) returns uuid
language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; obj storage.objects%rowtype; doc uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted backend required'; end if;
 select * into strict inv from public.invoices where id=p_invoice for update;
 if p_size is null or p_size<=0 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
 or nullif(p_etag,'') is null then raise exception 'Invalid S3 verification evidence'; end if;
 if split_part(p_path,'/',1)<>inv.organization_id::text or split_part(p_path,'/',2)<>inv.id::text
 or not private.is_invoice_document_canonical_path(p_path) then raise exception 'Invalid invoice document path'; end if;
 select * into strict obj from storage.objects where bucket_id='invoice-documents' and name=p_path
 and not coalesce(is_delete_marker,false) and archived_at is null;
 if (obj.metadata->>'size')::bigint is distinct from p_size
 or trim(both '"' from obj.metadata->>'eTag') is distinct from trim(both '"' from p_etag)
 then raise exception 'S3 object differs from verified file'; end if;
 select id into doc from public.invoice_documents where invoice_id=p_invoice and storage_path=p_path order by created_at limit 1;
 if doc is null then
 insert into public.invoice_documents(invoice_id,storage_path,file_name,mime_type)
 values(p_invoice,p_path,p_file_name,p_mime_type) returning id into doc;
 end if;
 insert into private.invoice_s3_confirmations(document_id,object_id,object_version,object_updated_at,etag,byte_size,sha256)
 values(doc,obj.id,obj.version,obj.updated_at,trim(both '"' from p_etag),p_size,p_sha256)
 on conflict(document_id) do update set object_id=excluded.object_id,object_version=excluded.object_version,
 object_updated_at=excluded.object_updated_at,etag=excluded.etag,byte_size=excluded.byte_size,sha256=excluded.sha256,verified_at=now();
 return doc;
end $$;
revoke all on function public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) to service_role;

;
