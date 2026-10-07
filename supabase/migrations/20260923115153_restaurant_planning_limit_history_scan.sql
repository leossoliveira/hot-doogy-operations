create or replace function public.create_transfer_plan(
 p_from_location_id uuid,p_to_location_id uuid,p_coverage_start date,p_coverage_end date,
 p_history_start date,p_history_end date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org uuid; sr record; ev jsonb; rows_json jsonb:='[]'; issues jsonb:='[]'; demand jsonb:='[]';
 report jsonb; missing_days jsonb; overlap_days jsonb; x record; factor numeric;
begin
 if p_from_location_id is null or p_to_location_id is null or p_from_location_id=p_to_location_id
 or p_coverage_start is null or p_coverage_end is null or p_history_start is null or p_history_end is null
 or p_coverage_end<p_coverage_start or p_history_end<p_history_start
 or p_history_end>=p_coverage_start or p_history_end-p_history_start>366 or p_coverage_end-p_coverage_start>31 then
  raise exception 'Invalid locations or date ranges';
 end if;
 select organization_id into org from public.locations where id=p_to_location_id and active;
 if org is null or not exists(select 1 from public.locations where id=p_from_location_id and organization_id=org and active)
 then raise exception 'Locations unavailable or from different organizations'; end if;
 -- An absent record is not proof of a zero-sales day.
 with days as (select generate_series(p_history_start::timestamp,p_history_end::timestamp,interval '1 day')::date d),
 coverage as (
 select d,count(b.id) n from days join public.locations l on l.id=p_to_location_id
 left join public.sales_import_batches b on b.location_id=l.id and b.pos_source='square_csv'
 and b.import_type='item_sales' and b.granularity='transaction'
 and b.period_start<=d::timestamp at time zone l.timezone
 and b.period_end>=(d+1)::timestamp at time zone l.timezone
 group by d)
 select coalesce(jsonb_agg(d) filter(where n=0),'[]'),coalesce(jsonb_agg(d) filter(where n>1),'[]')
 into missing_days,overlap_days from coverage;
 if jsonb_array_length(missing_days)>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','history_days_missing','dates',missing_days)); end if;
 if jsonb_array_length(overlap_days)>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','overlapping_imports','dates',overlap_days)); end if;
 for x in select distinct extract(isodow from d) dow from generate_series(p_coverage_start::timestamp,p_coverage_end::timestamp,interval '1 day') d loop
  if not exists(select 1 from generate_series(p_history_start::timestamp,p_history_end::timestamp,interval '1 day') h where extract(isodow from h)=x.dow)
  then issues:=issues||jsonb_build_array(jsonb_build_object('code','weekday_history_missing','weekday',x.dow)); end if;
 end loop;
 for sr in select s.id from public.sales_import_rows s join public.sales_import_batches b on b.id=s.batch_id
  join public.locations l on l.id=b.location_id
  where b.location_id=p_to_location_id and b.pos_source='square_csv' and b.import_type='item_sales'
  and b.granularity='transaction'
  and b.period_start<(p_history_end+1)::timestamp at time zone l.timezone
  and b.period_end>p_history_start::timestamp at time zone l.timezone
  and (private.square_csv_timestamp(s.raw_data->>'Date',s.raw_data->>'Time',l.timezone) is null
   or (private.square_csv_timestamp(s.raw_data->>'Date',s.raw_data->>'Time',l.timezone) at time zone l.timezone)::date between p_history_start and p_history_end)
 loop
  ev:=private.restaurant_evaluate_sale(sr.id);
  if ev->>'sale_date' is null then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','undated_sale','source_row_id',sr.id)); continue;
  end if;
  if (ev->>'sale_date')::date not between p_history_start and p_history_end then continue; end if;
  rows_json:=rows_json||jsonb_build_array(ev-'usage');
  select (select count(*)::numeric from generate_series(p_coverage_start::timestamp,p_coverage_end::timestamp,interval '1 day') d
    where extract(isodow from d)=extract(isodow from (ev->>'sale_date')::date))/
   nullif((select count(*)::numeric from generate_series(p_history_start::timestamp,p_history_end::timestamp,interval '1 day') d
    where extract(isodow from d)=extract(isodow from (ev->>'sale_date')::date)),0) into factor;
  if factor>0 then
   for x in select * from jsonb_array_elements(ev->'issues') loop
    issues:=issues||jsonb_build_array(x.value||jsonb_build_object('source_row_id',sr.id,'item',ev->>'item_name'));
   end loop;
   for x in select * from jsonb_array_elements(ev->'usage') loop
    demand:=demand||jsonb_build_array(x.value||jsonb_build_object('quantity_base',(x.value->>'quantity_base')::numeric*factor,'source_row_id',sr.id));
   end loop;
  end if;
 end loop;
 with quantities as (
  select (j->>'item_id')::uuid item_id,sum((j->>'quantity_base')::numeric) qty
  from jsonb_array_elements(demand) j group by 1),
 detail as (
  select i.id,i.internal_name,i.name,q.qty,bu.name base_unit,
   unit_choice.id item_unit_id,unit_choice.unit_name,unit_choice.quantity_in_base_unit,
   case when pr.production_location_id=p_from_location_id then 'confirmed'
    when pr.production_location_id is null then 'production_location_missing' else 'produced_elsewhere' end routing_status
  from quantities q join public.inventory_items i on i.id=q.item_id and i.item_type='prepared'
  join public.units bu on bu.id=i.base_unit_id
  left join lateral (
   select r.production_location_id from public.recipes r where r.output_inventory_item_id=i.id and r.active and r.classification='prep_recipe'
   order by r.id limit 1) pr on true
  left join lateral (
   select iu.id,u.name unit_name,iu.quantity_in_base_unit from public.inventory_item_units iu
   join public.units u on u.id=iu.unit_id where iu.inventory_item_id=i.id and
    (iu.is_count_unit or iu.is_receive_unit or exists(select 1 from public.recipe_versions v join public.recipes r on r.id=v.recipe_id
     where r.output_inventory_item_id=i.id and r.active and v.status='active' and v.yield_item_unit_id=iu.id))
   order by case u.name when 'Box' then 1 when 'Bag' then 2 when 'Container' then 3 when 'Bucket' then 4 when 'Bottle' then 5
    when 'Portion' then 6 when 'Batch' then 7 else 20 end,iu.display_order,iu.id limit 1
  ) unit_choice on true)
 select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
  'inventory_item_id',id,'internal_name',internal_name,'quantity_base',qty,'base_unit',base_unit,
  'item_unit_id',item_unit_id,'unit',unit_name,'quantity',qty/nullif(quantity_in_base_unit,0),
  'routing_status',routing_status,'stock_deducted',false) order by internal_name),'[]'))
 into report from detail;
 for x in select * from jsonb_array_elements(report->'items') loop
  if x.value->>'routing_status'<>'confirmed' or x.value->>'item_unit_id' is null then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','preparation_routing_or_unit_missing','item',x.value->>'internal_name'));
  end if;
 end loop;
 return report||jsonb_build_object('calculation_status',case when jsonb_array_length(issues)>0 then 'incomplete' else 'complete' end,
  'issues',issues,'source_rows',jsonb_array_length(rows_json),
  'complete_rows',(select count(*) from jsonb_array_elements(rows_json) j where j->>'calculation_status'='complete'),
  'history_start',p_history_start,'history_end',p_history_end,'coverage_start',p_coverage_start,'coverage_end',p_coverage_end,
  'method','same_weekday_mean','recipe_basis','current_active_version','rounding','none',
  'stock_deducted',false,'transfer_created',false);
end $$;


alter function private.restaurant_recipe_usage(uuid,uuid,numeric,uuid[]) set plan_cache_mode=force_generic_plan;
alter function private.restaurant_evaluate_sale(uuid) set plan_cache_mode=force_generic_plan;
alter function private.resolve_square_csv_modifiers(uuid,uuid,uuid,text) set plan_cache_mode=force_generic_plan;
alter function public.create_transfer_plan(uuid,uuid,date,date,date,date) set jit=off;

;
