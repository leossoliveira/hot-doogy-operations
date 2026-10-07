-- Evaluate MFA once per RLS statement and once at privileged RPC entry.
-- Keep every restrictive mfa_required policy and all existing role/scope checks.
begin;
CREATE OR REPLACE FUNCTION private.is_org_member(target_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  select exists (

    select 1

    from public.organization_members m

    where
      m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'

  );

$function$;

CREATE OR REPLACE FUNCTION private.has_org_role(target_org uuid, allowed_roles member_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  select exists (

    select 1

    from public.organization_members m

    where
      m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(allowed_roles)

  );

$function$;

CREATE OR REPLACE FUNCTION private.can_location(target_location uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.locations l JOIN public.organization_members m ON m.organization_id=l.organization_id
  WHERE l.id=target_location AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND (m.role IN ('owner','admin') OR EXISTS (
    SELECT 1 FROM public.member_location_access a WHERE a.member_id=m.id AND a.location_id=l.id))
 );
$function$;

CREATE OR REPLACE FUNCTION private.can_storage(target_storage uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.storage_areas s JOIN public.organization_members m ON m.organization_id=s.organization_id
  WHERE s.id=target_storage AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND private.can_location(s.location_id)
  AND (m.role IN ('owner','admin','manager','chef') OR EXISTS (
   SELECT 1 FROM public.member_storage_area_access a WHERE a.member_id=m.id AND a.storage_area_id=s.id AND a.can_view))
 );
$function$;

CREATE OR REPLACE FUNCTION private.can_supplier(target_supplier uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.suppliers s JOIN public.organization_members m ON m.organization_id=s.organization_id
  WHERE s.id=target_supplier AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND (m.role IN ('owner','admin','manager') OR EXISTS (
   SELECT 1 FROM public.member_supplier_access a WHERE a.member_id=m.id AND a.supplier_id=s.id AND a.can_view))
 );
$function$;

-- MFA checks at RPC entry points.
CREATE OR REPLACE FUNCTION public.approve_invoice(target_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invoice public.invoices%rowtype;
  v_receipt public.purchase_receipts%rowtype;
  v_posted_lines integer := 0;
  v_price_rows integer := 0;
  v_receipt_completed boolean := false;
begin
 if not private.mfa_authorized() then raise exception 'Complete two-step verification before accessing your workspace.' using errcode='42501'; end if;
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  select * into v_invoice from public.invoices where id = target_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not private.is_org_member(v_invoice.organization_id) or not private.can_location(v_invoice.location_id) or not private.can_supplier(v_invoice.supplier_id) or not private.has_org_role(v_invoice.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role]) then raise exception 'You are not allowed to approve this invoice'; end if;
  if v_invoice.status not in ('uploaded', 'processing', 'review') then raise exception 'Only uploaded, processing, or review invoices can be approved'; end if;
  if not exists (
    select 1 from public.invoice_documents d
    join storage.objects o on o.bucket_id = 'invoice-documents' and o.name = d.storage_path
    where d.invoice_id = v_invoice.id
  ) then raise exception 'A stored invoice document must be linked before approval'; end if;

  insert into public.supplier_item_price_history (organization_id, location_id, supplier_item_id, invoice_line_id, price_per_purchase_unit, status, effective_at)
  select v_invoice.organization_id, v_invoice.location_id, il.supplier_item_id, il.id, il.unit_price, 'pending'::public.price_status, coalesce(v_invoice.invoice_date::timestamptz, now())
  from public.invoice_lines il
  where il.invoice_id = v_invoice.id and il.supplier_item_id is not null and il.unit_price is not null;
  get diagnostics v_price_rows = row_count;

  if v_invoice.receipt_id is not null then
    select * into v_receipt from public.purchase_receipts where id = v_invoice.receipt_id for update;
    if not found or v_receipt.organization_id <> v_invoice.organization_id or v_receipt.location_id <> v_invoice.location_id or v_receipt.supplier_id <> v_invoice.supplier_id then raise exception 'The linked receipt must belong to the same organization, location, and supplier'; end if;
    if v_receipt.status not in ('draft', 'receiving', 'completed') then raise exception 'The linked receipt must be draft, receiving, or completed'; end if;

    insert into public.inventory_transactions (organization_id, location_id, storage_area_id, inventory_item_id, transaction_type, quantity_base, unit_cost_base, total_cost, source_type, source_id, occurred_at, created_by)
    select v_receipt.organization_id, v_receipt.location_id, prl.storage_area_id, prl.inventory_item_id, 'purchase_receipt'::public.inventory_transaction_type, prl.quantity_base,
      case when coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)) is null then null else coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)) / nullif(prl.quantity_base, 0) end,
      coalesce(prl.line_total, il.line_total, prl.quantity_received * coalesce(prl.unit_cost, il.unit_price)), 'purchase_receipt_line', prl.id, coalesce(v_receipt.received_at, now()), (select auth.uid())
    from public.purchase_receipt_lines prl
    join lateral (
      select il.* from public.invoice_lines il
      where il.invoice_id = v_invoice.id
        and ((prl.supplier_item_id is not null and il.supplier_item_id = prl.supplier_item_id) or (prl.supplier_item_id is null and il.inventory_item_id = prl.inventory_item_id))
        and il.unit_price is not null
      order by il.created_at, il.id limit 1
    ) il on true
    where prl.receipt_id = v_receipt.id
      and not exists (select 1 from public.inventory_transactions it where it.source_type = 'purchase_receipt_line' and it.source_id = prl.id);
    get diagnostics v_posted_lines = row_count;

    if exists (select 1 from public.purchase_receipt_lines where receipt_id = v_receipt.id)
       and not exists (select 1 from public.purchase_receipt_lines prl where prl.receipt_id = v_receipt.id and not exists (select 1 from public.inventory_transactions it where it.source_type = 'purchase_receipt_line' and it.source_id = prl.id)) then
      update public.purchase_receipts set status = 'completed', received_at = coalesce(received_at, now()) where id = v_receipt.id;
      v_receipt_completed := true;
    end if;
  end if;

  update public.invoices set status = 'approved' where id = v_invoice.id;
  return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_status', 'approved', 'receipt_id', v_invoice.receipt_id, 'receipt_completed', v_receipt_completed, 'inventory_transactions_created', v_posted_lines, 'price_history_rows_created', v_price_rows);
end;
$function$;

CREATE OR REPLACE FUNCTION private.restaurant_process_sales_import(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare b public.sales_import_batches%rowtype; sr record; ev jsonb; m jsonb;
 captured integer:=0; complete_count integer:=0; errors integer:=0; report jsonb; catalog_sig text;
begin
 select * into b from public.sales_import_batches where id=p_batch_id for update;
 if not found then raise exception 'Import batch unavailable'; end if;
 if not (coalesce(auth.jwt()->>'role','')='service_role' or (session_user in ('postgres','supabase_admin') and current_setting('role') in ('none','postgres'))) then
 if not private.mfa_authorized() then raise exception 'Complete two-step verification before accessing your workspace.' using errcode='42501'; end if;
  if auth.uid() is null or not private.is_org_member(b.organization_id) or not private.can_location(b.location_id)
   or not private.has_org_role(b.organization_id,array['owner','admin','manager']::public.member_role[]) then
   raise exception 'Not authorized to process this sales batch' using errcode='42501';
  end if;
 end if;
 if b.pos_source<>'square_csv' or b.import_type<>'item_sales' or b.granularity<>'transaction' then raise exception 'Unsupported import format'; end if;
 catalog_sig:=private.restaurant_catalog_signature(b.organization_id);
 for sr in select * from public.sales_import_rows where batch_id=b.id order by row_number,id loop
  ev:=private.restaurant_evaluate_cached(sr.id,catalog_sig);
  insert into private.restaurant_sale_cache(source_row_id,catalog_signature,raw_signature,evaluation)
  values(sr.id,catalog_sig,md5(sr.raw_data::text||b.organization_id::text||b.location_id::text||b.period_start::text||b.period_end::text),ev)
  on conflict(source_row_id) do update set catalog_signature=excluded.catalog_signature,raw_signature=excluded.raw_signature,evaluation=excluded.evaluation;
  if (ev->>'valid_sale')::boolean then
   captured:=captured+1;
   insert into public.sales_item_facts(organization_id,location_id,import_batch_id,source_row_id,menu_item_id,
    external_item_name,fact_date,period_start,period_end,granularity,quantity,gross_sales,discounts,net_sales,dimensions)
   values(b.organization_id,b.location_id,b.id,sr.id,(ev->>'menu_item_id')::uuid,ev->>'item_name',
    (ev->>'sale_date')::date,(ev->>'occurred_at')::timestamptz,(ev->>'occurred_at')::timestamptz+interval '1 microsecond',
    'transaction',(ev->>'quantity')::numeric,private.square_csv_numeric(sr.raw_data->>'Gross Sales'),
    private.square_csv_numeric(sr.raw_data->>'Discounts'),private.square_csv_numeric(sr.raw_data->>'Net Sales'),
    ev - 'usage')
   on conflict(source_row_id) where source_row_id is not null do update set
    menu_item_id=excluded.menu_item_id,external_item_name=excluded.external_item_name,fact_date=excluded.fact_date,
    period_start=excluded.period_start,period_end=excluded.period_end,quantity=excluded.quantity,
    gross_sales=excluded.gross_sales,discounts=excluded.discounts,net_sales=excluded.net_sales,dimensions=excluded.dimensions;
   for m in select * from jsonb_array_elements(ev->'modifiers') loop
    insert into public.sales_modifier_facts(organization_id,location_id,import_batch_id,source_row_id,source_position,
     modifier_id,parent_menu_item_id,external_modifier_name,fact_date,period_start,period_end,granularity,quantity,dimensions)
    values(b.organization_id,b.location_id,b.id,sr.id,(m->>'position')::integer,(m->>'modifier_id')::uuid,
     (ev->>'menu_item_id')::uuid,m->>'source_name',(ev->>'sale_date')::date,
     (ev->>'occurred_at')::timestamptz,(ev->>'occurred_at')::timestamptz+interval '1 microsecond',
     'transaction',(ev->>'quantity')::numeric,m)
    on conflict(source_row_id,source_position) where source_row_id is not null do update set
     modifier_id=excluded.modifier_id,parent_menu_item_id=excluded.parent_menu_item_id,
     external_modifier_name=excluded.external_modifier_name,fact_date=excluded.fact_date,
     period_start=excluded.period_start,period_end=excluded.period_end,quantity=excluded.quantity,dimensions=excluded.dimensions;
   end loop;
   delete from public.sales_modifier_facts f where f.source_row_id=sr.id and f.source_position>jsonb_array_length(ev->'modifiers');
  else
   delete from public.sales_modifier_facts where source_row_id=sr.id;
   delete from public.sales_item_facts where source_row_id=sr.id;
  end if;
  if ev->>'calculation_status'='complete' then complete_count:=complete_count+1; else errors:=errors+1; end if;
  update public.sales_import_rows set
   normalized_data=normalized_data||jsonb_build_object('menu_item_id',ev->'menu_item_id','modifiers',ev->'modifiers','evaluation',ev-'usage'),
   processed=(ev->>'calculation_status'='complete'),
   error_message=case when ev->>'calculation_status'='complete' then null else (ev->'issues')::text end
  where id=sr.id;
 end loop;
 report:=jsonb_build_object('batch_id',b.id,'captured_rows',captured,'complete_rows',complete_count,
  'pending_rows',errors,'status',case when errors>0 then 'completed_with_errors' else 'completed' end);
 update public.sales_import_batches set total_rows=complete_count+errors,processed_rows=complete_count,
  error_rows=errors,status=(report->>'status')::public.import_status,processed_at=now() where id=b.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 values(b.organization_id,b.location_id,auth.uid(),'process_sales_import','sales_import_batch',b.id,report);
 return report;
end $function$;

CREATE OR REPLACE FUNCTION private.internal_request_authorize(p_org uuid, p_location uuid, p_storage uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if coalesce(auth.jwt()->>'role','')='service_role' or
 (session_user in ('postgres','supabase_admin') and current_setting('role') in ('none','postgres')) then return; end if;
 if not private.mfa_authorized() then raise exception 'Complete two-step verification before accessing your workspace.' using errcode='42501'; end if;
 if auth.uid() is null or not coalesce(private.is_org_member(p_org)
 and private.can_location(p_location)
 and private.has_org_role(p_org,array['owner','admin','manager','chef']::public.member_role[])
 and (p_storage is null or private.can_storage(p_storage)),false) then
 raise exception 'Not authorized for this store or storage area' using errcode='42501';
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_purchase_receipt(target_receipt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_order public.purchase_orders%rowtype;
  v_posted_lines integer := 0;
  v_total_lines integer := 0;
  v_order_status public.purchase_order_status;
begin
 if not private.mfa_authorized() then raise exception 'Complete two-step verification before accessing your workspace.' using errcode='42501'; end if;
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

CREATE OR REPLACE FUNCTION private.web_command(p_command_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare canonical jsonb; old private.web_commands%rowtype; x jsonb; results jsonb:='[]';
begin
 if not private.mfa_authorized() then raise exception 'Complete two-step verification before accessing your workspace.' using errcode='42501'; end if;
 if auth.uid() is null or not private.has_org_role('6013ed02-626a-497c-b951-619069035532',array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Sem permissão.' using errcode='42501';end if;
 if p_command_id is null or p_action<>'batch' or jsonb_typeof(p_payload->'changes') is distinct from 'array' or jsonb_array_length(p_payload->'changes') not between 1 and 100 then raise exception 'Comando inválido.';end if;
 canonical:=jsonb_build_object('actor',auth.uid(),'action',p_action,'payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into old from private.web_commands where command_id=p_command_id;
 if found then if old.payload<>canonical then raise exception 'Comando reutilizado com dados diferentes.';end if;return old.result;end if;
 for x in select value from jsonb_array_elements(p_payload->'changes') loop results:=results||jsonb_build_array(private.web_operation(x->>'action',x->'payload'));end loop;
 insert into private.web_commands(command_id,actor,payload,result) values(p_command_id,auth.uid(),canonical,results);
 return results;
end $function$;

CREATE OR REPLACE FUNCTION private.web_preparation_sales(p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; signature text; result jsonb;
begin
 if not private.mfa_authorized() then raise exception 'Complete two-step verification before accessing your workspace.' using errcode='42501'; end if;
 if auth.uid() is null or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Sem permissão.' using errcode='42501';end if;
 if p_offset<0 or p_limit not between 1 and 250 then raise exception 'Página inválida.';end if;
 signature:=private.restaurant_catalog_signature(org);
 with evaluated as materialized (
 select f.fact_date,f.location_id,private.restaurant_evaluate_cached(f.source_row_id,signature) value
 from (select * from public.sales_item_facts f where f.organization_id=org and private.can_location(f.location_id) and f.source_row_id is not null order by f.id limit p_limit offset p_offset) f
 ), usage as (
 select fact_date,location_id,(u->>'item_id')::uuid item_id,sum((u->>'quantity_base')::numeric) quantity
 from evaluated cross join lateral jsonb_array_elements(value->'usage') u

 group by 1,2,3
 ), days as (select fact_date,location_id,count(*) total,count(*) filter(where jsonb_array_length(value->'issues')>0) incomplete from evaluated group by 1,2),
 issues as (select i->>'code' code,location_id,count(*) occurrences from evaluated cross join lateral jsonb_array_elements(value->'issues') i group by 1,2)
 select jsonb_build_object('meta',jsonb_build_object('extractedAt',now(),'source','Supabase recipe calculation','readOnly',true),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'itemId',item_id,'baseQty',quantity)) from usage where exists(select 1 from public.inventory_items i where i.id=usage.item_id and i.item_type='prepared')),'[]'),
 'itemRows',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'itemId',item_id,'baseQty',quantity)) from usage),'[]'),
 'days',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'totalLines',total,'incompleteLines',incomplete)) from days),'[]'),
 'issues',coalesce((select jsonb_agg(jsonb_build_object('code',code,'locationId',location_id,'occurrences',occurrences)) from issues),'[]')) into result;
 return result;
end $function$;

notify pgrst, 'reload schema';
commit;

;
