-- Only authorized, paginated calculation endpoints may refresh this derived
-- cache. Financial, import and stock records are never modified here.
create function private.restaurant_evaluate_refresh_cache(p_row uuid,p_catalog_signature text)
returns jsonb language plpgsql volatile set search_path='' as $$
declare result jsonb; raw_sig text;
begin
 select md5(s.raw_data::text||b.organization_id::text||b.location_id::text||b.period_start::text||b.period_end::text)
 into raw_sig from public.sales_import_rows s join public.sales_import_batches b on b.id=s.batch_id where s.id=p_row;
 select c.evaluation into result from private.restaurant_sale_cache c
 where c.source_row_id=p_row and c.catalog_signature=p_catalog_signature and c.raw_signature=raw_sig;
 if result is not null then return result; end if;
 result:=private.restaurant_evaluate_sale(p_row);
 if raw_sig is not null and p_catalog_signature is not null
 and pg_try_advisory_xact_lock(hashtextextended(p_row::text,21021507)) then
  insert into private.restaurant_sale_cache(source_row_id,catalog_signature,raw_signature,evaluation)
  values(p_row,p_catalog_signature,raw_sig,result)
  on conflict(source_row_id) do update set catalog_signature=excluded.catalog_signature,
   raw_signature=excluded.raw_signature,evaluation=excluded.evaluation;
 end if;
 return result;
end $$;
revoke all on function private.restaurant_evaluate_refresh_cache(uuid,text) from public,anon,authenticated;
grant execute on function private.restaurant_evaluate_refresh_cache(uuid,text) to service_role;

-- Preserve the deployed authorization, pagination, aggregation and business
-- rules verbatim. The original STABLE evaluator remains available unchanged.
do $$
declare target regprocedure; definition text;
begin
 foreach target in array array['private.web_preparation_sales(integer,integer)'::regprocedure,
  'private.preparation_usage_period(date,date,uuid,integer,integer)'::regprocedure] loop
  definition:=pg_get_functiondef(target);
  if position('private.restaurant_evaluate_cached(f.source_row_id,signature)' in definition)=0 then
   raise exception 'Unexpected calculation endpoint definition: %',target;
  end if;
  if position('private.can_location(f.location_id)' in definition)=0 then
   raise exception 'Unexpected location guard: %',target;
  end if;
  definition:=replace(definition,'private.restaurant_evaluate_cached(f.source_row_id,signature)',
   'private.restaurant_evaluate_refresh_cache(f.source_row_id,signature)');
  -- Evaluate the exact same location authorization once per location, not once
  -- for every historical row skipped by each pagination offset.
  execute replace(definition,'private.can_location(f.location_id)',
   'f.location_id in (select allowed_location.id from public.locations allowed_location where private.can_location(allowed_location.id))');
 end loop;
end $$;
