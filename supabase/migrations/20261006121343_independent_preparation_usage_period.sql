CREATE OR REPLACE FUNCTION private.preparation_usage_period(p_start date, p_end date, p_location uuid, p_offset integer, p_limit integer)
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
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>730 then raise exception 'Invalid date range.'; end if;
 signature:=private.restaurant_catalog_signature(org);
 with evaluated as materialized (
 select f.fact_date,f.location_id,private.restaurant_evaluate_cached(f.source_row_id,signature) value
 from (select * from public.sales_item_facts f where f.organization_id=org and private.can_location(f.location_id) and f.source_row_id is not null and f.fact_date between p_start and p_end and (p_location is null or f.location_id=p_location) order by f.id limit p_limit offset p_offset) f
 ), usage as (
 select fact_date,location_id,(u->>'item_id')::uuid item_id,sum((u->>'quantity_base')::numeric) quantity
 from evaluated cross join lateral jsonb_array_elements(value->'usage') u

 group by 1,2,3
 ), days as (select fact_date,location_id,count(*) total,count(*) filter(where jsonb_array_length(value->'issues')>0) incomplete from evaluated group by 1,2),
 issues as (select i->>'code' code,location_id,count(*) occurrences from evaluated cross join lateral jsonb_array_elements(value->'issues') i group by 1,2)
 select jsonb_build_object('meta',jsonb_build_object('extractedAt',now(),'source','Supabase recipe calculation','readOnly',true,'processed',(select count(*) from evaluated)),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'itemId',item_id,'baseQty',quantity)) from usage where exists(select 1 from public.inventory_items i where i.id=usage.item_id and i.item_type='prepared')),'[]'),
 'itemRows',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'itemId',item_id,'baseQty',quantity)) from usage),'[]'),
 'days',coalesce((select jsonb_agg(jsonb_build_object('date',fact_date,'locationId',location_id,'totalLines',total,'incompleteLines',incomplete)) from days),'[]'),
 'issues',coalesce((select jsonb_agg(jsonb_build_object('code',code,'locationId',location_id,'occurrences',occurrences)) from issues),'[]')) into result;
 return result;
end $function$;

revoke all on function private.preparation_usage_period(date,date,uuid,integer,integer) from public,anon;
grant execute on function private.preparation_usage_period(date,date,uuid,integer,integer) to authenticated;
create or replace function public.preparation_usage_period(p_start date,p_end date,p_location uuid default null,p_offset integer default 0,p_limit integer default 100)
returns jsonb language sql security invoker set search_path='' as $$
select private.preparation_usage_period(p_start,p_end,p_location,p_offset,p_limit);
$$;
revoke all on function public.preparation_usage_period(date,date,uuid,integer,integer) from public,anon;
grant execute on function public.preparation_usage_period(date,date,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
;
