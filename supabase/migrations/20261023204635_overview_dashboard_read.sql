-- Dashboard-only snapshot. Caller token, MFA, membership and existing table RLS apply.
-- No cache, SECURITY DEFINER, permission expansion or operational writes.
create or replace function public.overview_dashboard_read(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare result jsonb := '{}'::jsonb; page jsonb; order_ids uuid[]; receipt_ids uuid[];
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.is_org_member(p_organization_id) then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (select id,name,active from public.locations where organization_id=p_organization_id ) r;
 result := result || jsonb_build_object('locations',page);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (select id,internal_name,active,item_type from public.inventory_items where organization_id=p_organization_id ) r;
 result := result || jsonb_build_object('inventory_items',page);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (select id,location_id,inventory_item_id,active from public.location_inventory_items where organization_id=p_organization_id ) r;
 result := result || jsonb_build_object('location_inventory_items',page);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (select id,recipe_type,production_location_id,output_inventory_item_id from public.recipes where organization_id=p_organization_id ) r;
 result := result || jsonb_build_object('recipes',page);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (select distinct on (recipe_id) id,recipe_id,version_number,status from public.recipe_versions where organization_id=p_organization_id order by recipe_id,version_number desc,id) r;
 result := result || jsonb_build_object('recipe_versions',page);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (select id,status,requesting_location_id,fulfilling_location_id from public.internal_requests where organization_id=p_organization_id and status not in ('completed','cancelled')) r;
 result := result || jsonb_build_object('internal_requests',page);
 -- Staff never queries sales or purchasing, even if underlying permissions evolve.
 if not private.is_operations_staff() then
  select coalesce(array_agg(id),'{}'::uuid[]) into order_ids from (
   select id,status,row_number() over(partition by location_id order by coalesce(ordered_at,created_at) desc,id) position
   from public.purchase_orders where organization_id=p_organization_id
  ) ranked where position<=4 or status='ordered';
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (
   select id,organization_id,location_id,supplier_id,status,order_number,expected_receive_at,ordered_at,created_at
   from public.purchase_orders where organization_id=p_organization_id and id=any(order_ids)
  ) r;
  result := result || jsonb_build_object('purchase_orders',page);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (
   select id,name from public.suppliers where organization_id=p_organization_id
    and id in (select supplier_id from public.purchase_orders where id=any(order_ids) and organization_id=p_organization_id)
  ) r;
  result := result || jsonb_build_object('suppliers',page);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (
   select id,purchase_order_id,purchase_item_unit_id,ordered_purchase_qty
   from public.purchase_order_lines where organization_id=p_organization_id and purchase_order_id=any(order_ids)
  ) r;
  result := result || jsonb_build_object('purchase_order_lines',page);
  select coalesce(array_agg(id),'{}'::uuid[]) into receipt_ids from public.purchase_receipts
   where organization_id=p_organization_id and purchase_order_id=any(order_ids);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (
   select id,purchase_order_id,status,notes,received_at from public.purchase_receipts
   where organization_id=p_organization_id and id=any(receipt_ids)
  ) r;
  result := result || jsonb_build_object('purchase_receipts',page);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (
   select id,receipt_id,purchase_order_line_id,received_item_unit_id,quantity_received
   from public.purchase_receipt_lines where organization_id=p_organization_id and receipt_id=any(receipt_ids)
  ) r;
  result := result || jsonb_build_object('purchase_receipt_lines',page);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into page from (
   select id,organization_id,location_id,supplier_id,purchase_order_id,status,
    jsonb_build_object('receiving',extraction->'receiving') extraction
   from public.invoices where organization_id=p_organization_id and purchase_order_id=any(order_ids)
  ) r;
  result := result || jsonb_build_object('invoices',page);
  -- Aggregate in PostgreSQL: no individual sale, invoice line, stock movement,
  -- count, preparation batch, attachment or recipe component leaves the database.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.date,r."locationId"),'[]'::jsonb) into page from (
   select fact_date as date,location_id as "locationId",sum(coalesce(quantity,0)) as quantity,
    sum(coalesce(net_sales,0)) as "netSales",sum(coalesce(gross_sales,0)) as "grossSales",
    sum(coalesce(discounts,0)) as discounts,count(*) as "factCount"
   from public.sales_item_facts where organization_id=p_organization_id group by fact_date,location_id
  ) r;
  result := result || jsonb_build_object('overview_sales_daily',page);
 end if;
 return result;
end;
$function$;
revoke all on function public.overview_dashboard_read(uuid) from public,anon;
grant execute on function public.overview_dashboard_read(uuid) to authenticated;
