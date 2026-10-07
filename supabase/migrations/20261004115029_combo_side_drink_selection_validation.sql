create table private.combo_selection_options (
 menu_item_id uuid not null references public.menu_items(id),
 rule_id uuid primary key references public.menu_item_modifier_rules(id),
 selection_group text not null check(selection_group in ('side','drink'))
);
revoke all on private.combo_selection_options from public,anon,authenticated;
grant select on private.combo_selection_options to service_role;
insert into private.combo_selection_options(menu_item_id,rule_id,selection_group)
select mi.id,ru.id,case when m.name in ('French Fries (Small)','French Fries (Medium)','French Fries (Large)','Cheddar Fries','Bacon Cheddar Fries','Chicken Nuggets (6 Pcs)','Chicken Nuggets (9 Pcs)') then 'side' else 'drink' end
from public.menu_items mi join public.menu_item_modifier_rules ru on ru.menu_item_id=mi.id join public.modifiers m on m.id=ru.modifier_id
where mi.name='Make it a COMBO' and m.name in ('French Fries (Small)','French Fries (Medium)','French Fries (Large)','Cheddar Fries','Bacon Cheddar Fries','Chicken Nuggets (6 Pcs)','Chicken Nuggets (9 Pcs)','Coca-Cola® Original Taste','Coca-Cola® Zero Sugar','Diet Coke®','Sprite® Lemon Lime','Fanta® Orange','Barq''s® Root Beer','Hi-C® Poppin'' Pink Lemonade','Minute Maid® Lemonade','Minute Maid® Pink Lemonade','Mott’s® Apple Juice','Open Water® Aluminum Bottle');

CREATE OR REPLACE FUNCTION private.restaurant_evaluate_sale(p_row uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
declare sr public.sales_import_rows%rowtype; b public.sales_import_batches%rowtype;
 mi public.menu_items%rowtype; m jsonb; mods jsonb; q numeric; at_time timestamptz; tz text;
 issues jsonb:='[]'; usage jsonb:='[]'; sub jsonb; sign numeric; valid boolean:=true;
 candidates uuid[]; resolved text; ru public.menu_item_modifier_rules%rowtype; amount numeric; is_combo boolean:=false; side_count integer; drink_count integer;
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
  is_combo:=exists(select 1 from private.combo_selection_options co where co.menu_item_id=mi.id);
  if not is_combo then
  sub:=private.restaurant_recipe_usage(mi.recipe_id,b.location_id,q);
  usage:=usage||(sub->'usage'); issues:=issues||(sub->'issues');
  end if;
 end if;
 mods:=private.resolve_square_csv_modifiers(b.organization_id,b.location_id,mi.id,sr.raw_data->>'Modifiers Applied');
 if is_combo then
  select count(*) filter(where co.selection_group='side'),count(*) filter(where co.selection_group='drink')
  into side_count,drink_count
  from jsonb_array_elements(mods) z
  join private.combo_selection_options co on co.rule_id=(z->>'rule_id')::uuid and co.menu_item_id=mi.id
  where z->>'status'='linked';
  if side_count<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','combo_side_selection_count','expected',1,'actual',side_count)); end if;
  if drink_count<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','combo_drink_selection_count','expected',1,'actual',drink_count)); end if;
 end if;
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
   elsif exists(select 1 from private.modifier_recipe_contexts cx where cx.organization_id=b.organization_id and cx.modifier_id=ru.modifier_id) then
    sub:=private.restaurant_context_modifier_usage(b.organization_id,ru.modifier_id,b.location_id,sr.raw_data->>'Dining Option',q*sign);
    usage:=usage||(sub->'usage'); issues:=issues||(sub->'issues');
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
end $function$;

CREATE OR REPLACE FUNCTION private.restaurant_catalog_signature(p_org uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
 union all select 'modifier_contexts',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by modifier_id,location_id,order_context),'')) from private.modifier_recipe_contexts t where organization_id=p_org
 union all select 'combo_options',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by rule_id),'')) from private.combo_selection_options t join public.menu_items mi on mi.id=t.menu_item_id where mi.organization_id=p_org
 union all select 'units',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.units t
 )
 select md5('engine-v1.3-combo:'||string_agg(k||':'||h,',' order by k)) from hashes;
$function$;

;
