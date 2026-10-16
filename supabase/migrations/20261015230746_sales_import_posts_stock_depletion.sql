-- Sales imports now post sale_consumption to the stock ledger.
-- Before this, process_sales_import only wrote sales facts; the only sale depletion ever
-- recorded was a one-off posting on 2026-09-24. Batches created before the cutoff are left
-- untouched (no backfill), so reprocessing an old batch never changes stock.
-- inventory_transactions is append-only, so each run posts only the difference between what
-- the batch should deplete and what is already posted for it (reprocessing is idempotent).

create or replace function private.restaurant_batch_stock_usage(p_batch_id uuid,p_location_id uuid)
returns table(inventory_item_id uuid,storage_area_id uuid,quantity_base numeric)
language sql stable security definer set search_path to '' as $function$
 with usage as (
  select (u->>'item_id')::uuid item,sum((u->>'quantity_base')::numeric) qty
  from public.sales_import_rows r
  join private.restaurant_sale_cache c on c.source_row_id=r.id
  cross join jsonb_array_elements(coalesce(c.evaluation->'usage','[]'::jsonb)) u
  where r.batch_id=p_batch_id and c.evaluation->>'calculation_status'='complete'
  group by 1)
 select u.item,coalesce(li.default_storage_area_id,
  (select a.storage_area_id from public.inventory_item_storage_areas a
   where a.location_id=p_location_id and a.inventory_item_id=u.item order by a.created_at,a.id limit 1)),u.qty
 from usage u
 left join public.location_inventory_items li on li.location_id=p_location_id and li.inventory_item_id=u.item;
$function$;
revoke all on function private.restaurant_batch_stock_usage(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.restaurant_process_sales_import(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare b public.sales_import_batches%rowtype; sr record; ev jsonb; m jsonb;
 captured integer:=0; complete_count integer:=0; errors integer:=0; report jsonb; catalog_sig text;
 stock_posting text:='skipped_pre_cutoff'; stock_rows integer:=0; unplaced integer:=0;
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
 -- Stock depletion: only batches created from the cutoff on; older batches are never re-posted.
 if b.created_at>=timestamptz '2026-10-15 12:00:00+00' then
  stock_posting:='posted';
  select count(*) into unplaced from private.restaurant_batch_stock_usage(b.id,b.location_id) u where u.storage_area_id is null;
  insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,
   quantity_base,source_type,source_id,period_start,period_end,occurred_at,created_by)
  select b.organization_id,b.location_id,d.storage_area_id,d.inventory_item_id,'sale_consumption',d.qty,
   'sales_import_batch',b.id,b.period_start,b.period_end,b.period_end,auth.uid()
  from (
   select coalesce(t.inventory_item_id,p.inventory_item_id) inventory_item_id,coalesce(t.storage_area_id,p.storage_area_id) storage_area_id,
    round(coalesce(-t.quantity_base,0)-coalesce(p.quantity_base,0),6) qty
   from (select * from private.restaurant_batch_stock_usage(b.id,b.location_id) where storage_area_id is not null) t
   full join (
    select x.inventory_item_id,x.storage_area_id,sum(x.quantity_base) quantity_base from public.inventory_transactions x
    where x.source_type='sales_import_batch' and x.source_id=b.id and x.transaction_type='sale_consumption'
    group by 1,2) p on p.inventory_item_id=t.inventory_item_id and p.storage_area_id=t.storage_area_id
  ) d where d.qty<>0;
  get diagnostics stock_rows=row_count;
 end if;
 report:=jsonb_build_object('batch_id',b.id,'captured_rows',captured,'complete_rows',complete_count,
  'pending_rows',errors,'status',case when errors>0 then 'completed_with_errors' else 'completed' end,
  'stock_posting',stock_posting,'stock_rows_posted',stock_rows,'stock_items_without_area',unplaced);
 update public.sales_import_batches set total_rows=complete_count+errors,processed_rows=complete_count,
  error_rows=errors,status=(report->>'status')::public.import_status,processed_at=now() where id=b.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 values(b.organization_id,b.location_id,auth.uid(),'process_sales_import','sales_import_batch',b.id,report);
 return report;
end $function$;
