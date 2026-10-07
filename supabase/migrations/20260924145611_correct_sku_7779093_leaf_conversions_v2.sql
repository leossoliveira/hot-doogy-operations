
do $$
declare
  v_item uuid := 'ba7f0762-46c3-494f-83bb-2f86922e2238';
  v_case_iu uuid := '1b3518e6-034e-4aee-b8f7-abbcd8005d8f';
  v_bag_iu uuid := 'a9ae0ef2-3f34-41cc-9bf8-dc4ff302638a';
  v_leaf_iu uuid := '3bf36b78-e247-4bc8-badb-b222ac892624';
  v_ounce_iu uuid := '3a9c3a1d-a98e-4e1f-9f35-9e9b53ab08e6';
  v_leaf_unit uuid;
begin
  select unit_id into v_leaf_unit from public.inventory_item_units where id=v_leaf_iu;

  update public.inventory_item_units set is_base_unit=false,is_count_unit=false where id=v_ounce_iu;
  update public.inventory_item_units
  set quantity_in_base_unit=1,is_base_unit=true,is_purchase_unit=false,is_receive_unit=false,is_count_unit=false
  where id=v_leaf_iu;
  update public.inventory_items set base_unit_id=v_leaf_unit,updated_at=now() where id=v_item;
  update public.inventory_item_units
  set quantity_in_base_unit=300,is_base_unit=false,is_purchase_unit=true,is_receive_unit=true,is_count_unit=false
  where id=v_case_iu;
  update public.inventory_item_units
  set quantity_in_base_unit=150,is_base_unit=false,is_purchase_unit=false,is_receive_unit=false,is_count_unit=true
  where id=v_bag_iu;

  update public.invoice_lines
  set quantity_base=quantity*300
  where inventory_item_id=v_item and item_unit_id=v_case_iu;

  update public.purchase_receipt_lines
  set quantity_base=quantity_received*300
  where inventory_item_id=v_item and received_item_unit_id=v_case_iu;

  update public.stock_count_lines scl
  set counted_base_quantity=x.new_count,
      variance_base_quantity=x.new_count-scl.expected_base_quantity
  from (
    select sce.stock_count_line_id,sum(sce.quantity*iu.quantity_in_base_unit) new_count
    from public.stock_count_line_entries sce
    join public.inventory_item_units iu on iu.id=sce.inventory_item_unit_id
    join public.stock_count_lines sl on sl.id=sce.stock_count_line_id
    where sl.inventory_item_id=v_item
    group by sce.stock_count_line_id
  ) x
  where scl.id=x.stock_count_line_id;

  insert into public.inventory_transactions
    (organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,
     quantity_base,unit_cost_base,total_cost,source_type,source_id,occurred_at,created_by)
  select organization_id,location_id,storage_area_id,inventory_item_id,'manual_adjustment',
         70,unit_cost_base,case when unit_cost_base is null then null else 70*unit_cost_base end,
         'unit_conversion_correction',id,occurred_at,created_by
  from public.inventory_transactions
  where id='6162ccf0-3c3b-49c6-b051-4626f68ae1af'
    and not exists (
      select 1 from public.inventory_transactions x
      where x.source_type='unit_conversion_correction' and x.source_id='6162ccf0-3c3b-49c6-b051-4626f68ae1af'
    );

  insert into public.inventory_transactions
    (organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,
     quantity_base,unit_cost_base,total_cost,source_type,source_id,occurred_at,created_by)
  select organization_id,location_id,storage_area_id,inventory_item_id,'manual_adjustment',
         140,unit_cost_base,case when unit_cost_base is null then null else 140*unit_cost_base end,
         'unit_conversion_correction',id,occurred_at,created_by
  from public.inventory_transactions
  where id='641e8c86-5406-4f5f-8479-3cc024822026'
    and not exists (
      select 1 from public.inventory_transactions x
      where x.source_type='unit_conversion_correction' and x.source_id='641e8c86-5406-4f5f-8479-3cc024822026'
    );

  delete from public.inventory_item_units where id=v_ounce_iu;
end $$;

;
