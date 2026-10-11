-- Existing invoices are retained; new records require explicit financial classification.
alter table public.invoices add column document_kind text not null default 'invoice'
 check (document_kind='invoice');
alter table public.invoices alter column document_kind drop default;

-- Preserve the deployed operation body, changing only the invoice insertion.
do $migration$
declare definition text; old_insert text := $old$insert into public.invoices(id,organization_id,location_id,supplier_id,invoice_number,invoice_date,due_date,total,created_by) values(id,org,loc,vendor,p->>'number',(p->>'date')::date,(p->>'dueDate')::date,(p->>'total')::numeric,actor);$old$;
begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if position(old_insert in definition)=0 then raise exception 'Unexpected web_operation invoice implementation'; end if;
 execute replace(definition,old_insert,$new$if p->>'documentKind' is distinct from 'invoice' or p->>'documentReviewed' is distinct from 'true' then raise exception 'INVOICE_CLASSIFICATION_REQUIRED'; end if;
 insert into public.invoices(id,organization_id,location_id,supplier_id,invoice_number,invoice_date,due_date,total,created_by,document_kind) values(id,org,loc,vendor,p->>'number',(p->>'date')::date,(p->>'dueDate')::date,(p->>'total')::numeric,actor,p->>'documentKind');$new$);
end $migration$;

create table private.invoice_document_reviews (
 invoice_id uuid not null references public.invoices(id) on delete cascade,
 storage_path text not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 byte_size bigint not null check(byte_size>0 and byte_size<=20971520),
 reviewed_by uuid not null, reviewed_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '15 minutes',
 consumed_at timestamptz,
 primary key(invoice_id,storage_path,sha256)
);
revoke all on private.invoice_document_reviews from public,anon,authenticated,service_role;

create function public.review_invoice_document(p_invoice uuid,p_extension text,p_sha256 text,p_size bigint,p_kind text,p_reviewed boolean) returns text
language plpgsql security definer set search_path='' as $$
declare path text; inv public.invoices%rowtype;
begin
 if auth.uid() is null or not private.mfa_authorized() then raise exception 'Authentication required'; end if;
 if p_kind is distinct from 'invoice' or p_reviewed is distinct from true then raise exception 'INVOICE_CLASSIFICATION_REQUIRED: receiving proofs cannot be uploaded'; end if;
 path:=public.invoice_document_upload_path(p_invoice,p_extension);
 select * into strict inv from public.invoices where id=p_invoice;
 if inv.document_kind<>'invoice' then raise exception 'Invoice required'; end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size is null or p_size<=0 or p_size>20971520 then raise exception 'Invalid file evidence'; end if;
 insert into private.invoice_document_reviews(invoice_id,storage_path,sha256,byte_size,reviewed_by)
 values(p_invoice,path,p_sha256,p_size,auth.uid())
 on conflict(invoice_id,storage_path,sha256) do update set byte_size=excluded.byte_size,reviewed_by=excluded.reviewed_by,reviewed_at=now(),expires_at=now()+interval '15 minutes',consumed_at=null;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 values(inv.organization_id,inv.location_id,auth.uid(),'invoice_document_classified','invoice',inv.id,jsonb_build_object('document_kind','invoice','method','human_review','sha256',p_sha256,'byte_size',p_size));
 return path;
end $$;
revoke all on function public.review_invoice_document(uuid,text,text,bigint,text,boolean) from public,anon,service_role;
grant execute on function public.review_invoice_document(uuid,text,text,bigint,text,boolean) to authenticated;

-- Uploads use the reviewed backend path; direct browser Storage writes are denied.
create policy invoice_review_backend_insert on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'invoice-documents');
create policy invoice_review_backend_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'invoice-documents') with check(bucket_id<>'invoice-documents');

create function private.require_invoice_document_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.invoice_id=old.invoice_id and new.storage_path=old.storage_path then return new; end if;
 if not exists(select 1 from private.invoice_document_reviews r where r.invoice_id=new.invoice_id and r.storage_path=new.storage_path and r.expires_at>now() and r.consumed_at is null) then
 raise exception 'INVOICE_CLASSIFICATION_REQUIRED: review the original before attaching it'; end if;
 return new;
end $$;
revoke all on function private.require_invoice_document_review() from public,anon,authenticated,service_role;
create trigger invoice_document_review_guard before insert or update on public.invoice_documents
for each row execute function private.require_invoice_document_review();

-- Retain existing integrity checks, including the deployed audit channel fields.
alter function public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) set schema private;
revoke all on function private.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) from public,anon,authenticated,service_role;
create function public.confirm_invoice_s3_document(p_invoice uuid,p_path text,p_file_name text,p_mime_type text,p_size bigint,p_etag text,p_sha256 text) returns uuid
language plpgsql security definer set search_path='' as $$
declare doc uuid;
begin
 if not (coalesce(auth.role(),'')='service_role' or (session_user='postgres' and coalesce(current_setting('role',true),'none') in ('none','postgres') and coalesce(auth.role(),'')='')) then raise exception 'Trusted backend required'; end if;
 perform 1 from private.invoice_document_reviews where invoice_id=p_invoice and storage_path=p_path and sha256=p_sha256 and byte_size=p_size and expires_at>now() and consumed_at is null for update;
 if not found then raise exception 'INVOICE_CLASSIFICATION_REQUIRED: no matching review for this file'; end if;
 doc:=private.confirm_invoice_s3_document(p_invoice,p_path,p_file_name,p_mime_type,p_size,p_etag,p_sha256);
 update private.invoice_document_reviews set consumed_at=now() where invoice_id=p_invoice and storage_path=p_path and sha256=p_sha256;
 return doc;
end $$;
revoke all on function public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) to service_role;
