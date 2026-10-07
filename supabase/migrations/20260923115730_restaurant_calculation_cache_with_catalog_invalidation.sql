
create table private.restaurant_sale_cache(
 source_row_id uuid primary key references public.sales_import_rows(id) on delete cascade,
 catalog_signature text not null, raw_signature text not null, evaluation jsonb not null
);
alter table private.restaurant_sale_cache enable row level security;
revoke all on private.restaurant_sale_cache from public,anon,authenticated;
grant all on private.restaurant_sale_cache to service_role;

create function private.restaurant_catalog_signature(p_org uuid) returns text
language sql stable set search_path='' as $$
 with hashes as (
 select 'menu' k,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) h from public.menu_items t where organization_id=p_org
 union all select 'menu_locations',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.location_menu_items t where organization_id=p_org
 union all select 'item_maps',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.pos_item_mappings t where organization_id=p_org
 union all select 'modifier_maps',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.pos_modifier_mappings t where organization_id=p_org
 union all select 'modifiers',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.modifiers t where organization_id=p_org
 union all select 'rules',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.menu_item_modifier_rules t where organization_id=p_org
 union all select 'recipes',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.recipes t where organization_id=p_org
 union all select 'versions',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.recipe_versions t where organization_id=p_org
 union all select 'components',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.recipe_components t where organization_id=p_org
 union all select 'item_units',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.inventory_item_units t where organization_id=p_org
 union all select 'items',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.inventory_items t where organization_id=p_org
 union all select 'locations',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.locations t where organization_id=p_org
 union all select 'units',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.units t
 )
 select md5('engine-v1.1:'||string_agg(k||':'||h,',' order by k)) from hashes;
$$;
create function private.restaurant_evaluate_cached(p_row uuid,p_catalog_signature text) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 select c.evaluation into result from private.restaurant_sale_cache c
 join public.sales_import_rows s on s.id=c.source_row_id join public.sales_import_batches b on b.id=s.batch_id
 where c.source_row_id=p_row and c.catalog_signature=p_catalog_signature
 and c.raw_signature=md5(s.raw_data::text||b.organization_id::text||b.location_id::text||b.period_start::text||b.period_end::text);
 if result is not null then return result; end if;
 return private.restaurant_evaluate_sale(p_row);
end $$;
revoke all on function private.restaurant_catalog_signature(uuid),private.restaurant_evaluate_cached(uuid,text) from public,anon,authenticated;
grant execute on function private.restaurant_catalog_signature(uuid),private.restaurant_evaluate_cached(uuid,text) to service_role;
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

CREATE OR REPLACE FUNCTION public.create_transfer_plan(p_from_location_id uuid, p_to_location_id uuid, p_coverage_start date, p_coverage_end date, p_history_start date, p_history_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare org uuid; sr record; ev jsonb; rows_json jsonb:='[]'; issues jsonb:='[]'; demand jsonb:='[]';
 report jsonb; missing_days jsonb; overlap_days jsonb; x record; factor numeric; catalog_sig text;
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
 catalog_sig:=private.restaurant_catalog_signature(org);
 for sr in select s.id from public.sales_import_rows s join public.sales_import_batches b on b.id=s.batch_id
  join public.locations l on l.id=b.location_id
  where b.location_id=p_to_location_id and b.pos_source='square_csv' and b.import_type='item_sales'
  and b.granularity='transaction'
  and b.period_start<(p_history_end+1)::timestamp at time zone l.timezone
  and b.period_end>p_history_start::timestamp at time zone l.timezone
  and (private.square_csv_timestamp(s.raw_data->>'Date',s.raw_data->>'Time',l.timezone) is null
   or (private.square_csv_timestamp(s.raw_data->>'Date',s.raw_data->>'Time',l.timezone) at time zone l.timezone)::date between p_history_start and p_history_end)
 loop
  ev:=private.restaurant_evaluate_cached(sr.id,catalog_sig);
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
end $function$;

;
