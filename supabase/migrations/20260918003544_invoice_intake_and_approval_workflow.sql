begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoice-documents',
  'invoice-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.invoices
  alter column created_by set default auth.uid();

alter table public.purchase_receipts
  alter column received_by set default auth.uid();

drop policy if exists invoice_documents_select on storage.objects;
drop policy if exists invoice_documents_insert on storage.objects;
drop policy if exists invoice_documents_update on storage.objects;
drop policy if exists invoice_documents_delete on storage.objects;

create policy invoice_documents_select
on storage.objects for select to authenticated
using (
  bucket_id = 'invoice-documents'
  and exists (
    select 1
    from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy invoice_documents_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'invoice-documents'
  and exists (
    select 1
    from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy invoice_documents_update
on storage.objects for update to authenticated
using (
  bucket_id = 'invoice-documents'
  and exists (
    select 1
    from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  bucket_id = 'invoice-documents'
  and exists (
    select 1
    from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy invoice_documents_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'invoice-documents'
  and exists (
    select 1
    from public.invoices i
    where i.id::text = (storage.foldername(name))[2]
      and i.organization_id::text = (storage.foldername(name))[1]
      and private.is_org_member(i.organization_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

drop policy if exists rm2_invoice_insert on public.invoices;
drop policy if exists rm2_invoice_update on public.invoices;
drop policy if exists rm2_invoice_line_insert on public.invoice_lines;
drop policy if exists rm2_invoice_line_update on public.invoice_lines;
drop policy if exists rm2_invoice_line_delete on public.invoice_lines;
drop policy if exists rm2_invoice_document_insert on public.invoice_documents;
drop policy if exists rm2_invoice_document_update on public.invoice_documents;
drop policy if exists rm2_invoice_document_delete on public.invoice_documents;
drop policy if exists rm2_receipt_insert on public.purchase_receipts;
drop policy if exists rm2_receipt_update on public.purchase_receipts;
drop policy if exists rm2_receipt_line_insert on public.purchase_receipt_lines;
drop policy if exists rm2_receipt_line_update on public.purchase_receipt_lines;
drop policy if exists rm2_receipt_line_delete on public.purchase_receipt_lines;

create policy rm2_invoice_insert on public.invoices
for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.can_supplier(supplier_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  and created_by = (select auth.uid())
  and status in ('uploaded', 'processing', 'review')
);

create policy rm2_invoice_update on public.invoices
for update to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.can_supplier(supplier_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  and status in ('uploaded', 'processing', 'review')
)
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.can_supplier(supplier_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  and status in ('uploaded', 'processing', 'review', 'cancelled')
);

create policy rm2_invoice_line_insert on public.invoice_lines
for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.organization_id = invoice_lines.organization_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_invoice_line_update on public.invoice_lines
for update to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  private.is_org_member(organization_id)
  and exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.organization_id = invoice_lines.organization_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_invoice_line_delete on public.invoice_lines
for delete to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_invoice_document_insert on public.invoice_documents
for insert to authenticated
with check (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_invoice_document_update on public.invoice_documents
for update to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_invoice_document_delete on public.invoice_documents
for delete to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and i.status in ('uploaded', 'processing', 'review')
      and private.is_org_member(i.organization_id)
      and private.can_location(i.location_id)
      and private.can_supplier(i.supplier_id)
      and private.has_org_role(i.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_receipt_insert on public.purchase_receipts
for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.can_supplier(supplier_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  and received_by = (select auth.uid())
  and status in ('draft', 'receiving')
);

create policy rm2_receipt_update on public.purchase_receipts
for update to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.can_supplier(supplier_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  and status in ('draft', 'receiving')
)
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.can_supplier(supplier_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  and status in ('draft', 'receiving', 'cancelled')
);

create policy rm2_receipt_line_insert on public.purchase_receipt_lines
for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.can_storage(storage_area_id)
  and exists (
    select 1 from public.purchase_receipts r
    where r.id = receipt_id
      and r.organization_id = purchase_receipt_lines.organization_id
      and r.status in ('draft', 'receiving')
      and private.can_location(r.location_id)
      and private.can_supplier(r.supplier_id)
      and private.has_org_role(r.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_receipt_line_update on public.purchase_receipt_lines
for update to authenticated
using (
  exists (
    select 1 from public.purchase_receipts r
    where r.id = receipt_id
      and r.status in ('draft', 'receiving')
      and private.is_org_member(r.organization_id)
      and private.can_location(r.location_id)
      and private.can_supplier(r.supplier_id)
      and private.can_storage(purchase_receipt_lines.storage_area_id)
      and private.has_org_role(r.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  private.is_org_member(organization_id)
  and private.can_storage(storage_area_id)
  and exists (
    select 1 from public.purchase_receipts r
    where r.id = receipt_id
      and r.organization_id = purchase_receipt_lines.organization_id
      and r.status in ('draft', 'receiving')
      and private.can_location(r.location_id)
      and private.can_supplier(r.supplier_id)
      and private.has_org_role(r.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy rm2_receipt_line_delete on public.purchase_receipt_lines
for delete to authenticated
using (
  exists (
    select 1 from public.purchase_receipts r
    where r.id = receipt_id
      and r.status in ('draft', 'receiving')
      and private.is_org_member(r.organization_id)
      and private.can_location(r.location_id)
      and private.can_supplier(r.supplier_id)
      and private.can_storage(purchase_receipt_lines.storage_area_id)
      and private.has_org_role(r.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create unique index if not exists inventory_transactions_receipt_line_once
on public.inventory_transactions (source_type, source_id)
where source_type = 'purchase_receipt_line';

create or replace function public.approve_invoice(target_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invoice public.invoices%rowtype;
  v_receipt public.purchase_receipts%rowtype;
  v_posted_lines integer := 0;
  v_price_rows integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  select * into v_invoice
  from public.invoices
  where id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if not private.is_org_member(v_invoice.organization_id)
     or not private.can_location(v_invoice.location_id)
     or not private.can_supplier(v_invoice.supplier_id)
     or not private.has_org_role(v_invoice.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role]) then
    raise exception 'You are not allowed to approve this invoice';
  end if;

  if v_invoice.status not in ('uploaded', 'processing', 'review') then
    raise exception 'Only uploaded, processing, or review invoices can be approved';
  end if;

  if v_invoice.receipt_id is null then
    raise exception 'A purchase receipt must be linked before approval';
  end if;

  select * into v_receipt
  from public.purchase_receipts
  where id = v_invoice.receipt_id
  for update;

  if not found
     or v_receipt.organization_id <> v_invoice.organization_id
     or v_receipt.location_id <> v_invoice.location_id
     or v_receipt.supplier_id <> v_invoice.supplier_id then
    raise exception 'The linked receipt must belong to the same organization, location, and supplier';
  end if;

  if v_receipt.status not in ('draft', 'receiving') then
    raise exception 'The linked receipt must be draft or receiving';
  end if;

  if not exists (
    select 1 from public.purchase_receipt_lines prl where prl.receipt_id = v_receipt.id
  ) then
    raise exception 'The linked receipt has no lines';
  end if;

  if exists (
    select 1
    from public.purchase_receipt_lines prl
    where prl.receipt_id = v_receipt.id
      and not exists (
        select 1
        from public.invoice_lines il
        where il.invoice_id = v_invoice.id
          and il.unit_price is not null
          and (
            (prl.supplier_item_id is not null and il.supplier_item_id = prl.supplier_item_id)
            or (prl.supplier_item_id is null and il.inventory_item_id = prl.inventory_item_id)
          )
      )
  ) then
    raise exception 'Each receipt line must have a matched invoice line with a unit price';
  end if;

  insert into public.supplier_item_price_history (
    organization_id, location_id, supplier_item_id, invoice_line_id,
    price_per_purchase_unit, status, effective_at
  )
  select
    v_invoice.organization_id,
    v_invoice.location_id,
    il.supplier_item_id,
    il.id,
    il.unit_price,
    'pending'::public.price_status,
    coalesce(v_invoice.invoice_date::timestamptz, now())
  from public.invoice_lines il
  where il.invoice_id = v_invoice.id
    and il.supplier_item_id is not null
    and il.unit_price is not null;

  get diagnostics v_price_rows = row_count;

  insert into public.inventory_transactions (
    organization_id, location_id, storage_area_id, inventory_item_id,
    transaction_type, quantity_base, unit_cost_base, total_cost,
    source_type, source_id, occurred_at, created_by
  )
  select
    v_receipt.organization_id,
    v_receipt.location_id,
    prl.storage_area_id,
    prl.inventory_item_id,
    'purchase_receipt'::public.inventory_transaction_type,
    prl.quantity_base,
    case
      when coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)) is null then null
      else coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)) / nullif(prl.quantity_base, 0)
    end,
    coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)),
    'purchase_receipt_line',
    prl.id,
    coalesce(v_receipt.received_at, now()),
    (select auth.uid())
  from public.purchase_receipt_lines prl
  join lateral (
    select il.*
    from public.invoice_lines il
    where il.invoice_id = v_invoice.id
      and (
        (prl.supplier_item_id is not null and il.supplier_item_id = prl.supplier_item_id)
        or (prl.supplier_item_id is null and il.inventory_item_id = prl.inventory_item_id)
      )
    order by il.created_at, il.id
    limit 1
  ) il on true
  where prl.receipt_id = v_receipt.id
    and not exists (
      select 1
      from public.inventory_transactions it
      where it.source_type = 'purchase_receipt_line'
        and it.source_id = prl.id
    );

  get diagnostics v_posted_lines = row_count;

  update public.purchase_receipts
  set status = 'completed',
      received_at = coalesce(received_at, now())
  where id = v_receipt.id;

  update public.invoices
  set status = 'approved'
  where id = v_invoice.id;

  return jsonb_build_object(
    'invoice_id', v_invoice.id,
    'receipt_id', v_receipt.id,
    'invoice_status', 'approved',
    'receipt_status', 'completed',
    'inventory_transactions_created', v_posted_lines,
    'price_history_rows_created', v_price_rows
  );
end;
$function$;

revoke all on function public.approve_invoice(uuid) from public;
grant execute on function public.approve_invoice(uuid) to authenticated;

commit;
;
