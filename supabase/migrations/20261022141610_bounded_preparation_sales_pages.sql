-- New endpoints leave offset-based clients unchanged during rolling deployment.
-- The one-second cooperative budget lets completed evaluations commit before
-- another page starts; it is not a replacement for the statement timeout.
create function private.preparation_sales_page(p_after uuid,p_limit integer,p_signature text,
 p_start date,p_end date,p_location uuid,p_scoped boolean)
returns jsonb language plpgsql security definer set search_path='' set jit='off' as $$
declare
 org constant uuid := '6013ed02-626a-497c-b951-619069035532';
 signature text; deadline timestamptz; f record; evaluated jsonb := '[]';
 processed integer := 0; more boolean := false; cursor_id uuid := p_after; result jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,
  case when p_scoped then array['owner','admin','manager','chef','staff']::public.member_role[]
  else array['owner','admin','manager','chef']::public.member_role[] end) then
  raise exception 'Prep access denied' using errcode='42501';
 end if;
 if p_scoped is null or p_limit is null or p_limit not between 1 and 250 then
  raise exception 'Invalid page' using errcode='22023';end if;
 if p_scoped and (p_start is null or p_end is null or p_end<p_start or p_end-p_start>737) then
  raise exception 'Invalid date range' using errcode='22023';end if;
 signature := private.restaurant_catalog_signature(org);
 if p_signature is not null and p_signature is distinct from signature then
  raise exception 'The recipe catalog changed. Restart the calculation.' using errcode='40001';end if;
 deadline := clock_timestamp()+interval '1 second';
 for f in
  select s.id,s.fact_date,s.location_id,s.source_row_id from public.sales_item_facts s
  where s.organization_id=org and s.source_row_id is not null
   and (p_after is null or s.id>p_after)
   and s.location_id in (select l.id from public.locations l where private.can_location(l.id))
   and (not p_scoped or (s.fact_date between p_start and p_end and (p_location is null or s.location_id=p_location)))
  order by s.id limit p_limit+1
 loop
  if processed>=p_limit or (processed>0 and clock_timestamp()>=deadline) then more:=true;exit;end if;
  evaluated := evaluated || jsonb_build_array(jsonb_build_object('fact_date',f.fact_date,'location_id',f.location_id,
   'value',private.restaurant_evaluate_refresh_cache(f.source_row_id,signature)));
  processed:=processed+1;cursor_id:=f.id;
 end loop;
 with records as materialized (
  select * from jsonb_to_recordset(evaluated) as r(fact_date date,location_id uuid,value jsonb)
 ), usage as (
  select fact_date,location_id,(u->>'item_id')::uuid item_id,sum((u->>'quantity_base')::numeric) quantity
  from records cross join lateral jsonb_array_elements(value->'usage') u group by 1,2,3
 ), days as (
  select fact_date,location_id,count(*) total,count(*) filter(where jsonb_array_length(value->'issues')>0) incomplete
  from records group by 1,2
 ), issues as (
  select i->>'code' code,location_id,count(*) occurrences from records
  cross join lateral jsonb_array_elements(value->'issues') i group by 1,2
 )
 select jsonb_build_object('meta',jsonb_build_object('processed',processed,'hasMore',more,'nextCursor',cursor_id,
  'catalogSignature',signature,'extractedAt',now(),'source','Supabase recipe calculation'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'itemId',item_id,'baseQty',quantity)) from usage where exists(select 1 from public.inventory_items i where i.id=usage.item_id and i.item_type='prepared')),'[]'),
 'itemRows',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'itemId',item_id,'baseQty',quantity)) from usage),'[]'),
 'days',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'totalLines',total,'incompleteLines',incomplete)) from days),'[]'),
 'issues',coalesce((select jsonb_agg(jsonb_build_object('code',code,'locationId',location_id,'occurrences',occurrences)) from issues),'[]')) into result;
 return result;
end $$;
revoke all on function private.preparation_sales_page(uuid,integer,text,date,date,uuid,boolean) from public,anon,authenticated;
-- Invoker wrappers need EXECUTE, but the private schema is not exposed by REST.
-- The private function independently enforces MFA, organization, role and stores.
grant execute on function private.preparation_sales_page(uuid,integer,text,date,date,uuid,boolean) to authenticated;
create function public.operations_preparation_sales_page(p_after uuid default null,p_limit integer default 250,p_signature text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.preparation_sales_page(p_after,p_limit,p_signature,null,null,null,false)
$$;
create function public.preparation_usage_period_page(p_start date,p_end date,p_location uuid default null,
 p_after uuid default null,p_limit integer default 250,p_signature text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.preparation_sales_page(p_after,p_limit,p_signature,p_start,p_end,p_location,true)
$$;
revoke all on function public.operations_preparation_sales_page(uuid,integer,text) from public,anon;
revoke all on function public.preparation_usage_period_page(date,date,uuid,uuid,integer,text) from public,anon;
grant execute on function public.operations_preparation_sales_page(uuid,integer,text) to authenticated;
grant execute on function public.preparation_usage_period_page(date,date,uuid,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
