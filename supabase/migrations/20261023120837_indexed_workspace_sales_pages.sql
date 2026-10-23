-- Read-only pagination: identify the authorized page in a compact index, then
-- fetch only those rows. No policy, grant on business tables, or write path changes.
-- Keep unbounded text OUT of the index: long product names must never break writes.
set local lock_timeout = '5s';
create index sales_item_facts_workspace_page_idx
 on public.sales_item_facts (organization_id,id) include (location_id);

create function public.workspace_sales_page(
 p_organization_id uuid,p_after uuid default null,p_lower uuid default null,
 p_upper uuid default null,p_limit integer default 1000
) returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare result jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.is_org_member(p_organization_id) then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
 if p_limit is null or p_limit<1 or p_limit>1000 or
    (p_lower is not null and p_upper is not null and p_lower>=p_upper) then
  raise exception 'Invalid sales page bounds' using errcode='22023';
 end if;
 -- EXECUTE uses a custom plan for these bounds rather than reusing a generic
 -- plan that cannot estimate nullable cursor parameters. Values remain bound.
 execute $query$
 select coalesce(jsonb_agg(to_jsonb(detail) order by page.id),'[]'::jsonb)
 from (
  select id from public.sales_item_facts
  where organization_id=$1 and ($2::uuid is null or id>$2)
   and ($3::uuid is null or id>=$3) and ($4::uuid is null or id<$4)
  order by id limit $5
 ) page
 cross join lateral (
  select id,organization_id,location_id,menu_item_id,source_row_id,import_batch_id,
   fact_date,granularity,period_start,period_end,quantity,net_sales,gross_sales,
   discounts,refunds,external_item_id,external_item_name
  from public.sales_item_facts f where f.id=page.id and f.organization_id=$1
  limit 1
 ) detail
 $query$ into result using p_organization_id,p_after,p_lower,p_upper,p_limit;
 return result;
end;
$function$;
revoke all on function public.workspace_sales_page(uuid,uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.workspace_sales_page(uuid,uuid,uuid,uuid,integer) to authenticated;

-- Bounded first pages, executed with the caller's role and RLS. No data cache.
-- Identifiers come only from this explicit allowlist; values are bound parameters.
create or replace function public.workspace_read_batch(p_organization_id uuid,p_tables text[])
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare
 allowed constant text[] := array['waste_events','waste_event_lines','locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','recipe_steps','modifiers','menu_item_modifier_rules','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','invoices','invoice_lines','invoice_documents','internal_requests','internal_request_lines','internal_request_line_issues','interstore_transfers','interstore_transfer_lines','interstore_receipts','interstore_receipt_lines','store_count_observations','inventory_count_sessions','stock_counts','stock_count_lines','stock_count_line_entries','inventory_transactions','prep_batches','prep_batch_components','sales_item_facts','sales_import_batches','location_settings','menu_items','location_menu_items','pos_modifier_mappings','menu_item_prices','menu_categories'];
 scoped constant text[] := array['waste_events','locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','modifiers','menu_item_modifier_rules','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','invoices','invoice_lines','internal_requests','internal_request_line_issues','store_count_observations','inventory_count_sessions','stock_counts','stock_count_lines','inventory_transactions','prep_batches','prep_batch_components','sales_item_facts','sales_import_batches','location_settings','menu_items','location_menu_items','pos_modifier_mappings','menu_item_prices','menu_categories'];
 target text; selection text; predicate text; ordering text; page_limit integer; page jsonb; result jsonb := '{}'::jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.is_org_member(p_organization_id) then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
 if p_tables is null or cardinality(p_tables)<1 or cardinality(p_tables)>8 then
  raise exception 'Request between one and eight tables' using errcode='22023';
 end if;
 foreach target in array p_tables loop
  if target is null or not target=any(allowed) then raise exception 'Invalid workspace table' using errcode='22023';end if;
  if target='sales_item_facts' then
   result := result || jsonb_build_object(target,public.workspace_sales_page(p_organization_id));
   continue;
  end if;
  selection := case target
   when 'sales_item_facts' then 'id,organization_id,location_id,menu_item_id,source_row_id,import_batch_id,fact_date,granularity,period_start,period_end,quantity,net_sales,gross_sales,discounts,refunds,external_item_id,external_item_name'
   when 'inventory_count_sessions' then 'id,organization_id,location_id,created_by,employee_name,status,state,published,version,created_at,updated_at,completed_at'
   else '*' end;
  predicate := case when target='units' then 'where organization_id is null or organization_id=$1'
   when target=any(scoped) then 'where organization_id=$1' else '' end;
  ordering := case when target='location_settings' then 'location_id' else 'id' end;
  page_limit := case when target='sales_item_facts' then 1000 else 500 end;
  execute format('select coalesce(jsonb_agg(to_jsonb(page)),''[]''::jsonb) from (select %s from public.%I %s order by %I limit %s) page',selection,target,predicate,ordering,page_limit)
   into page using p_organization_id;
  result := result || jsonb_build_object(target,page);
 end loop;
 return result;
end;
$function$;
revoke all on function public.workspace_read_batch(uuid,text[]) from public,anon;
grant execute on function public.workspace_read_batch(uuid,text[]) to authenticated;
