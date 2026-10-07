
-- Restaurant operations v1: deterministic sales and proportional preparation demand.
-- Backend-only RPCs; no ledger writes. Existing RLS remains enforced.
alter table public.sales_modifier_facts
 add column source_row_id uuid references public.sales_import_rows(id),
 add column source_position integer;
alter table public.sales_modifier_facts add constraint sales_modifier_source_pair
 check ((source_row_id is null and source_position is null) or
        (source_row_id is not null and source_position > 0));
create unique index sales_modifier_source_unique
 on public.sales_modifier_facts(source_row_id,source_position) where source_row_id is not null;

create function private.restaurant_key(p_text text) returns text
language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(coalesce(p_text,'')), '[[:space:]]+', ' ', 'g'));
$$;

-- Keep context requirements: identical names alone do not authorize a modifier.
create or replace function private.resolve_square_csv_modifiers(
 p_org uuid,p_location uuid,p_menu uuid,p_text text) returns jsonb
language plpgsql stable set search_path='' as $$
declare token text; ordinal integer:=0; result jsonb:='[]'; candidates jsonb;
begin
 for token in select btrim(x) from unnest(string_to_array(coalesce(p_text,''),',')) x where btrim(x)<>'' loop
  ordinal:=ordinal+1;
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into candidates from (
   select distinct r.id rule_id,m.id modifier_id,coalesce(r.recipe_id,m.default_recipe_id) recipe_id,
    r.action,r.effect_type,r.inventory_item_id,r.item_unit_id,r.quantity,r.price catalog_price
   from public.menu_item_modifier_rules r
   join public.modifiers m on m.id=r.modifier_id and m.active and m.organization_id=p_org
   where r.organization_id=p_org and r.menu_item_id=p_menu and (
    exists(select 1 from public.pos_modifier_mappings pm
     where pm.organization_id=p_org and pm.location_id=p_location and pm.pos_source='square_csv'
     and pm.active and pm.modifier_id=m.id
     and private.restaurant_key(pm.external_modifier_name)=private.restaurant_key(token))
    or private.restaurant_key(m.name)=private.restaurant_key(token))
  ) c;
  result:=result || jsonb_build_array(jsonb_build_object('position',ordinal,'source_name',token,
   'status',case when jsonb_array_length(candidates)=1 then 'linked' else 'pending' end)
   || case when jsonb_array_length(candidates)=1 then candidates->0
   else jsonb_build_object('reason',case when jsonb_array_length(candidates)=0
    then 'Modifier rule required for this menu item' else 'Ambiguous modifier rule' end) end);
 end loop;
 return result;
end $$;

-- Recipe amounts for one sale/selection; legacy null yield means one menu serving.
-- Prep outputs remain terminals: do not also charge their ingredients.
create function private.restaurant_recipe_usage(
 p_recipe uuid,p_location uuid,p_quantity numeric,p_path uuid[] default '{}')
returns jsonb language plpgsql stable set search_path='' as $$
declare r public.recipes%rowtype; v public.recipe_versions%rowtype; c record;
 n integer; result jsonb:='[]'; issues jsonb:='[]'; sub jsonb; child uuid; child_count integer;
 amount numeric; output_size numeric;
begin
 if p_recipe=any(p_path) or cardinality(p_path)>=20 then
  return jsonb_build_object('usage','[]'::jsonb,'issues',jsonb_build_array(jsonb_build_object('code','recipe_cycle','recipe_id',p_recipe)));
 end if;
 select * into r from public.recipes where id=p_recipe and active
 and organization_id=(select organization_id from public.locations where id=p_location);
 if not found then
  return jsonb_build_object('usage','[]'::jsonb,'issues',jsonb_build_array(jsonb_build_object('code','recipe_missing','recipe_id',p_recipe)));
 end if;
 select count(*) into n from public.recipe_versions where recipe_id=p_recipe and status='active';
 if n<>1 then
  return jsonb_build_object('usage','[]'::jsonb,'issues',jsonb_build_array(jsonb_build_object('code','active_recipe_version_not_unique','recipe_id',p_recipe)));
 end if;
 select * into v from public.recipe_versions where recipe_id=p_recipe and status='active';
 n:=0;
 for c in
  select rc.*,iu.quantity_in_base_unit,i.item_type
  from public.get_recipe_components_for_location(v.id,p_location) rc
  join public.inventory_item_units iu on iu.id=rc.component_item_unit_id
    and iu.inventory_item_id=rc.component_inventory_item_id
  join public.inventory_items i on i.id=rc.component_inventory_item_id
 loop
  n:=n+1;
  amount:=p_quantity*c.quantity*c.quantity_in_base_unit/coalesce(v.yield_quantity,1)/(1-c.waste_percent);
  child:=null;
  select count(*),(array_agg(id order by id))[1] into child_count,child
   from public.recipes where output_inventory_item_id=c.component_inventory_item_id
   and active and classification='dish_recipe';
  if child_count>1 then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','nested_recipe_ambiguous','item_id',c.component_inventory_item_id));
  elsif child is not null then
   select iu.quantity_in_base_unit into output_size from public.recipe_versions cv
    join public.inventory_item_units iu on iu.id=cv.yield_item_unit_id
    where cv.recipe_id=child and cv.status='active';
   if output_size is null then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','nested_recipe_output_unit_missing','recipe_id',child));
   else
    sub:=private.restaurant_recipe_usage(child,p_location,amount/output_size,p_path||p_recipe);
    result:=result||(sub->'usage'); issues:=issues||(sub->'issues');
   end if;
  else
   result:=result||jsonb_build_array(jsonb_build_object('item_id',c.component_inventory_item_id,
    'quantity_base',amount,'recipe_version_id',v.id,'component_id',c.id));
  end if;
 end loop;
 if n=0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','recipe_has_no_components','recipe_id',p_recipe)); end if;
 return jsonb_build_object('usage',result,'issues',issues);
end $$;

create function private.restaurant_evaluate_sale(p_row uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare sr public.sales_import_rows%rowtype; b public.sales_import_batches%rowtype;
 mi public.menu_items%rowtype; m jsonb; mods jsonb; q numeric; at_time timestamptz; tz text;
 issues jsonb:='[]'; usage jsonb:='[]'; sub jsonb; sign numeric; valid boolean:=true;
 candidates uuid[]; resolved text; ru public.menu_item_modifier_rules%rowtype; amount numeric;
begin
 select * into sr from public.sales_import_rows where id=p_row;
 if not found then raise exception 'Import row unavailable'; end if;
 select * into b from public.sales_import_batches where id=sr.batch_id;
 if b.pos_source<>'square_csv' or b.import_type<>'item_sales' or b.granularity<>'transaction' then
  raise exception 'Unsupported sales import format';
 end if;
 select timezone into tz from public.locations where id=b.location_id;
 tz:=coalesce(tz,'UTC');
 q:=private.square_csv_numeric(sr.raw_data->>'Qty');
 at_time:=private.square_csv_timestamp(sr.raw_data->>'Date',sr.raw_data->>'Time',tz);
 resolved:=private.square_csv_resolved_item_name(sr.raw_data->>'Item',sr.raw_data->>'Price Point Name');
 if q is null or q::text in ('NaN','Infinity','-Infinity') or at_time is null or resolved is null
  or private.restaurant_key(sr.raw_data->>'Location')<>
     private.restaurant_key((select name from public.locations where id=b.location_id))
  or private.square_csv_numeric(sr.raw_data->>'Gross Sales') is null
  or private.square_csv_numeric(sr.raw_data->>'Discounts') is null
  or private.square_csv_numeric(sr.raw_data->>'Net Sales') is null then
  valid:=false; issues:=issues||jsonb_build_array(jsonb_build_object('code','invalid_sale_fields'));
 end if;
 if at_time is not null and (at_time<b.period_start or at_time>=b.period_end) then
  valid:=false; issues:=issues||jsonb_build_array(jsonb_build_object('code','sale_outside_batch_period'));
 end if;
 -- Exact approved mappings, SKU precedence, ambiguity fails closed.
 select array_agg(distinct pm.menu_item_id) into candidates
 from public.pos_item_mappings pm join public.menu_items x on x.id=pm.menu_item_id and x.active
 where pm.organization_id=b.organization_id and pm.location_id=b.location_id and pm.pos_source=b.pos_source and pm.active
 and nullif(sr.raw_data->>'SKU','') is not null and pm.external_item_id=sr.raw_data->>'SKU';
 if coalesce(cardinality(candidates),0)=0 then
  select array_agg(distinct pm.menu_item_id) into candidates
   from public.pos_item_mappings pm join public.menu_items x on x.id=pm.menu_item_id and x.active
   where pm.organization_id=b.organization_id and pm.location_id=b.location_id and pm.pos_source=b.pos_source and pm.active
   and private.restaurant_key(pm.external_item_name)=private.restaurant_key(resolved);
 end if;
 if coalesce(cardinality(candidates),0)=0 then
  select array_agg(distinct x.id) into candidates from public.menu_items x
  join public.location_menu_items lm on lm.menu_item_id=x.id and lm.location_id=b.location_id and lm.active
  where x.organization_id=b.organization_id and x.active and private.restaurant_key(x.name)=private.restaurant_key(resolved);
 end if;
 if cardinality(candidates)=1 then select * into mi from public.menu_items where id=candidates[1]; end if;
 if mi.id is null then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','menu_mapping_missing_or_ambiguous','item',resolved));
 elsif valid then
  sub:=private.restaurant_recipe_usage(mi.recipe_id,b.location_id,q);
  usage:=usage||(sub->'usage'); issues:=issues||(sub->'issues');
 end if;
 mods:=private.resolve_square_csv_modifiers(b.organization_id,b.location_id,mi.id,sr.raw_data->>'Modifiers Applied');
 for m in select * from jsonb_array_elements(mods) loop
  if m->>'status'<>'linked' then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','modifier_mapping_pending','modifier',m->>'source_name','position',m->'position'));
  elsif valid then
   select * into ru from public.menu_item_modifier_rules where id=(m->>'rule_id')::uuid
    and menu_item_id=mi.id and organization_id=b.organization_id;
   sign:=case when ru.action='remove' then -1 else 1 end;
   if ru.effect_type='none' then continue; end if;
   if (ru.effect_type='fixed_removal' and ru.action<>'remove') or
      (ru.effect_type='fixed_addition' and ru.action='remove') then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','modifier_effect_conflict','modifier',m->>'source_name'));
   elsif ru.inventory_item_id is not null and ru.recipe_id is null then
    select q*ru.quantity*iu.quantity_in_base_unit*sign into amount
     from public.inventory_item_units iu where iu.id=ru.item_unit_id and iu.inventory_item_id=ru.inventory_item_id;
    if amount is null then
     issues:=issues||jsonb_build_array(jsonb_build_object('code','modifier_unit_missing','modifier',m->>'source_name'));
    else usage:=usage||jsonb_build_array(jsonb_build_object('item_id',ru.inventory_item_id,'quantity_base',amount,'rule_id',ru.id)); end if;
   elsif ru.inventory_item_id is not null and ru.recipe_id is not null then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','modifier_target_ambiguous','modifier',m->>'source_name'));
   else
    sub:=private.restaurant_recipe_usage((m->>'recipe_id')::uuid,b.location_id,q*sign);
    usage:=usage||(sub->'usage'); issues:=issues||(sub->'issues');
   end if;
  end if;
 end loop;
 -- Never clamp an over-removal silently.
 if q>0 and exists(select 1 from jsonb_array_elements(usage) x group by x->>'item_id'
   having sum((x->>'quantity_base')::numeric)<0) then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','removal_exceeds_base'));
 end if;
 return jsonb_build_object('source_row_id',sr.id,'batch_id',b.id,'menu_item_id',mi.id,
  'item_name',resolved,'quantity',q,'occurred_at',at_time,'sale_date',(at_time at time zone tz)::date,
  'timezone',tz,'valid_sale',valid,'modifiers',mods,'usage',usage,'issues',issues,
  'calculation_status',case when jsonb_array_length(issues)=0 then 'complete' else 'incomplete' end);
end $$;

create function public.process_sales_import(p_batch_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.sales_import_batches%rowtype; sr record; ev jsonb; m jsonb;
 captured integer:=0; complete_count integer:=0; errors integer:=0; report jsonb;
begin
 select * into b from public.sales_import_batches where id=p_batch_id for update;
 if not found then raise exception 'Import batch unavailable'; end if;
 if b.pos_source<>'square_csv' or b.import_type<>'item_sales' or b.granularity<>'transaction' then raise exception 'Unsupported import format'; end if;
 for sr in select * from public.sales_import_rows where batch_id=b.id order by row_number,id loop
  ev:=private.restaurant_evaluate_sale(sr.id);
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
end $$;

-- Compatibility: existing callers now use the same deterministic implementation.
create or replace function public.process_square_csv_batch(p_batch_id uuid)
returns table(processed_rows integer,error_rows integer,status public.import_status)
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.process_sales_import(p_batch_id);
 return query select (result->>'complete_rows')::integer,(result->>'pending_rows')::integer,
  (result->>'status')::public.import_status;
end $$;

create function public.create_transfer_plan(
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

revoke all on function private.restaurant_key(text) from public,anon,authenticated;
revoke all on function private.restaurant_recipe_usage(uuid,uuid,numeric,uuid[]) from public,anon,authenticated;
revoke all on function private.restaurant_evaluate_sale(uuid) from public,anon,authenticated;
revoke all on function public.process_sales_import(uuid) from public,anon,authenticated;
revoke all on function public.process_square_csv_batch(uuid) from public,anon,authenticated;
revoke all on function public.create_transfer_plan(uuid,uuid,date,date,date,date) from public,anon,authenticated;
grant execute on function private.restaurant_key(text),private.restaurant_recipe_usage(uuid,uuid,numeric,uuid[]),
 private.restaurant_evaluate_sale(uuid),public.process_sales_import(uuid),public.process_square_csv_batch(uuid),
 public.create_transfer_plan(uuid,uuid,date,date,date,date) to service_role;
-- Trigger resolver is already used by authenticated insert/update; retain access to its new normalization helper.
grant execute on function private.restaurant_key(text) to authenticated;
notify pgrst,'reload schema';

;
