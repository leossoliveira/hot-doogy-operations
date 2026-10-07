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
  v_receipt_completed boolean := false;
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

  insert into public.supplier_item_price_history (
    organization_id, location_id, supplier_item_id, invoice_line_id,
    price_per_purchase_unit, status, effective_at
  )
  select
    v_invoice.organization_id, v_invoice.location_id, il.supplier_item_id, il.id,
    il.unit_price, 'pending'::public.price_status,
    coalesce(v_invoice.invoice_date::timestamptz, now())
  from public.invoice_lines il
  where il.invoice_id = v_invoice.id
    and il.supplier_item_id is not null
    and il.unit_price is not null;

  get diagnostics v_price_rows = row_count;

  if v_invoice.receipt_id is not null then
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

    insert into public.inventory_transactions (
      organization_id, location_id, storage_area_id, inventory_item_id,
      transaction_type, quantity_base, unit_cost_base, total_cost,
      source_type, source_id, occurred_at, created_by
    )
    select
      v_receipt.organization_id, v_receipt.location_id, prl.storage_area_id, prl.inventory_item_id,
      'purchase_receipt'::public.inventory_transaction_type, prl.quantity_base,
      case
        when coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)) is null then null
        else coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)) / nullif(prl.quantity_base, 0)
      end,
      coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)),
      'purchase_receipt_line', prl.id, coalesce(v_receipt.received_at, now()), (select auth.uid())
    from public.purchase_receipt_lines prl
    join lateral (
      select il.*
      from public.invoice_lines il
      where il.invoice_id = v_invoice.id
        and (
          (prl.supplier_item_id is not null and il.supplier_item_id = prl.supplier_item_id)
          or (prl.supplier_item_id is null and il.inventory_item_id = prl.inventory_item_id)
        )
        and il.unit_price is not null
      order by il.created_at, il.id
      limit 1
    ) il on true
    where prl.receipt_id = v_receipt.id
      and not exists (
        select 1 from public.inventory_transactions it
        where it.source_type = 'purchase_receipt_line' and it.source_id = prl.id
      );

    get diagnostics v_posted_lines = row_count;

    if exists (select 1 from public.purchase_receipt_lines where receipt_id = v_receipt.id)
       and not exists (
         select 1
         from public.purchase_receipt_lines prl
         where prl.receipt_id = v_receipt.id
           and not exists (
             select 1 from public.inventory_transactions it
             where it.source_type = 'purchase_receipt_line' and it.source_id = prl.id
           )
       ) then
      update public.purchase_receipts
      set status = 'completed', received_at = coalesce(received_at, now())
      where id = v_receipt.id;
      v_receipt_completed := true;
    end if;
  end if;

  update public.invoices set status = 'approved' where id = v_invoice.id;

  return jsonb_build_object(
    'invoice_id', v_invoice.id,
    'invoice_status', 'approved',
    'receipt_id', v_invoice.receipt_id,
    'receipt_completed', v_receipt_completed,
    'inventory_transactions_created', v_posted_lines,
    'price_history_rows_created', v_price_rows
  );
end;
$function$;

revoke execute on function public.approve_invoice(uuid) from public;
revoke execute on function public.approve_invoice(uuid) from anon;
grant execute on function public.approve_invoice(uuid) to authenticated;
;
