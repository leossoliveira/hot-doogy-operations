create or replace function private.web_preparation_sales(p_offset integer,p_limit integer) returns jsonb language plpgsql security definer set search_path='' set jit='off' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; signature text; result jsonb;
begin
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
end $$;
revoke all on function private.web_preparation_sales(integer,integer) from public,anon;
grant execute on function private.web_preparation_sales(integer,integer) to authenticated;
create or replace function public.operations_preparation_sales(p_offset integer default 0,p_limit integer default 200) returns jsonb language sql security invoker set search_path='' as $$select private.web_preparation_sales(p_offset,p_limit)$$;
revoke all on function public.operations_preparation_sales(integer,integer) from public,anon;
grant execute on function public.operations_preparation_sales(integer,integer) to authenticated;
;
