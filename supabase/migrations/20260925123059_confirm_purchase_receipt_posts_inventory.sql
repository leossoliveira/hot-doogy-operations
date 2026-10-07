begin;

create or replace function public.confirm_purchase_receipt(target_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_order public.purchase_orders%rowtype;
  v_posted_lines integer := 0;
  v_total_lines integer := 0;
  v_order_status public.purchase_order_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  select * into v_receipt
  from public.purchase_receipts
  where id = target_receipt_id
  for update;

  if not found then raise exception 'Purchase receipt not found'; end if;

  if not private.is_org_member(v_receipt.organization_id)
     or not private.can_location(v_receipt.location_id)
     or not private.can_supplier(v_receipt.supplier_id)
     or not private.has_org_role(v_receipt.organization_id, array[
       'owner'::public.member_role,
       'admin'::public.member_role,
       'manager'::public.member_role
     ]) then
    raise exception 'You are not allowed to confirm this purchase receipt';
  end if;

  if v_receipt.status = 'cancelled' then
    raise exception 'A cancelled purchase receipt cannot be confirmed';
  end if;

  select count(*) into v_total_lines
  from public.purchase_receipt_lines
  where receipt_id = v_receipt.id;

  if v_total_lines = 0 then
    raise exception 'The purchase receipt has no lines';
  end if;

  if exists (
    select 1
    from public.purchase_receipt_lines prl
    left join public.storage_areas sa on sa.id = prl.storage_area_id
    left join public.location_inventory_items lii
      on lii.location_id = v_receipt.location_id
     and lii.inventory_item_id = prl.inventory_item_id
     and lii.active
    left join public.inventory_item_storage_areas iisa
      on iisa.location_id = v_receipt.location_id
     and iisa.inventory_item_id = prl.inventory_item_id
     and iisa.storage_area_id = prl.storage_area_id
    where prl.receipt_id = v_receipt.id
      and (
        prl.quantity_received <= 0
        or prl.quantity_base <= 0
        or sa.id is null
        or not sa.active
        or sa.location_id <> v_receipt.location_id
        or lii.id is null
        or iisa.id is null
      )
  ) then
    raise exception 'Every receipt line must have a positive quantity and an active storage assignment at the receiving store';
  end if;

  if v_receipt.purchase_order_id is not null then
    select * into v_order
    from public.purchase_orders
    where id = v_receipt.purchase_order_id
    for update;

    if not found
       or v_order.organization_id <> v_receipt.organization_id
       or v_order.location_id <> v_receipt.location_id
       or v_order.supplier_id <> v_receipt.supplier_id then
      raise exception 'The linked purchase order must belong to the same organization, store, and supplier';
    end if;

    if v_order.status not in ('approved', 'ordered', 'partially_received', 'received') then
      raise exception 'The linked purchase order is not ready to receive';
    end if;
  end if;

  insert into public.inventory_transactions (
    organization_id, location_id, storage_area_id, inventory_item_id,
    transaction_type, quantity_base, unit_cost_base, total_cost,
    source_type, source_id, occurred_at, created_by
  )
  select
    v_receipt.organization_id, v_receipt.location_id, prl.storage_area_id,
    prl.inventory_item_id, 'purchase_receipt'::public.inventory_transaction_type,
    prl.quantity_base,
    case
      when coalesce(prl.line_total, prl.quantity_received * prl.unit_cost) is null then null
      else coalesce(prl.line_total, prl.quantity_received * prl.unit_cost) / nullif(prl.quantity_base, 0)
    end,
    coalesce(prl.line_total, prl.quantity_received * prl.unit_cost),
    'purchase_receipt_line', prl.id, coalesce(v_receipt.received_at, now()),
    (select auth.uid())
  from public.purchase_receipt_lines prl
  where prl.receipt_id = v_receipt.id
    and not exists (
      select 1 from public.inventory_transactions it
      where it.source_type = 'purchase_receipt_line' and it.source_id = prl.id
    );

  get diagnostics v_posted_lines = row_count;

  update public.purchase_receipts
  set status = 'completed',
      received_at = coalesce(received_at, now()),
      received_by = coalesce(received_by, (select auth.uid()))
  where id = v_receipt.id;

  if v_receipt.purchase_order_id is not null then
    if not exists (
      select 1
      from public.purchase_order_lines pol
      left join public.inventory_item_units poiu on poiu.id = pol.purchase_item_unit_id
      where pol.purchase_order_id = v_receipt.purchase_order_id
        and pol.ordered_purchase_qty > 0
        and coalesce((
          select sum(prl.quantity_base)
          from public.purchase_receipt_lines prl
          join public.purchase_receipts pr on pr.id = prl.receipt_id
          where pr.purchase_order_id = v_receipt.purchase_order_id
            and pr.status = 'completed'
            and prl.purchase_order_line_id = pol.id
        ), 0) + 0.000001 < pol.ordered_purchase_qty * coalesce(poiu.quantity_in_base_unit, 1)
    ) then
      v_order_status := 'received';
    else
      v_order_status := 'partially_received';
    end if;

    update public.purchase_orders
    set status = v_order_status, updated_at = now()
    where id = v_receipt.purchase_order_id;
  end if;

  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'receipt_status', 'completed',
    'purchase_order_id', v_receipt.purchase_order_id,
    'purchase_order_status', v_order_status,
    'receipt_lines', v_total_lines,
    'inventory_transactions_created', v_posted_lines,
    'already_posted_lines', v_total_lines - v_posted_lines
  );
end;
$function$;

comment on function public.confirm_purchase_receipt(uuid) is
  'Confirms a vendor receipt, posts each receipt line to the inventory ledger exactly once, and updates the linked purchase order status.';

revoke all on function public.confirm_purchase_receipt(uuid) from public;
grant execute on function public.confirm_purchase_receipt(uuid) to authenticated;

commit;
;
