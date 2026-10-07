create table private.menu_sales_consumption_policies (
 menu_item_id uuid primary key references public.menu_items(id),
 mode text not null check (mode='inventory_reconciled'),
 notes text not null
);
alter table private.menu_sales_consumption_policies enable row level security;
revoke all on private.menu_sales_consumption_policies from public, anon, authenticated;
grant select on private.menu_sales_consumption_policies to service_role;
comment on table private.menu_sales_consumption_policies is 'Explicit menu exceptions: sales are valid, while consumption requires inventory reconciliation. No inferred zero usage.';
insert into private.menu_sales_consumption_policies(menu_item_id,mode,notes)
select m.id,'inventory_reconciled','Fountain Soda is self-service. Selected flavors are preferences; actual flavors and refills are unmeasured. Syrup consumption must be reconciled from inventory.'
from public.menu_items m join public.organizations o on o.id=m.organization_id
where o.name='Hot Doogy Franchising Corporation' and m.name='Fountain Soda' and m.active;

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
 candidates uuid[]; resolved text; ru public.menu_item_modifier_rules%rowtype; amount numeric; is_combo boolean:=false; side_count integer; drink_count integer; inventory_reconciled boolean:=false;
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
  inventory_reconciled:=exists(select 1 from private.menu_sales_consumption_policies p where p.menu_item_id=mi.id and p.mode='inventory_reconciled');
  is_combo:=exists(select 1 from private.combo_selection_options co where co.menu_item_id=mi.id);
  if not is_combo and not inventory_reconciled then
  sub:=private.restaurant_recipe_usage(mi.recipe_id,b.location_id,q);
  usage:=usage||(sub->'usage'); issues:=issues||(sub->'issues');
  end if;
 end if;
 mods:=private.resolve_square_csv_modifiers(b.organization_id,b.location_id,mi.id,sr.raw_data->>'Modifiers Applied');
 if is_combo and not inventory_reconciled then
  select count(*) filter(where co.selection_group='side'),count(*) filter(where co.selection_group='drink')
  into side_count,drink_count
  from jsonb_array_elements(mods) z
  join private.combo_selection_options co on co.rule_id=(z->>'rule_id')::uuid and co.menu_item_id=mi.id
  where z->>'status'='linked';
  if side_count<>1 and exists(select 1 from private.combo_selection_options co where co.menu_item_id=mi.id and co.selection_group='side') then issues:=issues||jsonb_build_array(jsonb_build_object('code','combo_side_selection_count','expected',1,'actual',side_count)); end if;
  if drink_count<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','drink_selection_count','expected',1,'actual',drink_count)); end if;
 end if;
 if inventory_reconciled then
  select coalesce(jsonb_agg(
    case when z->>'status'='linked' and exists(
      select 1 from private.combo_selection_options co
      where co.menu_item_id=mi.id and co.rule_id=(z->>'rule_id')::uuid and co.selection_group='drink'
    ) then z || jsonb_build_object('consumption_role','preference_only') else z end
    order by (z->>'position')::integer),'[]'::jsonb)
  into mods from jsonb_array_elements(mods) z;
 end if;
 for m in select * from jsonb_array_elements(mods) loop
  if m->>'status'<>'linked' then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','modifier_mapping_pending','modifier',m->>'source_name','position',m->'position'));
  elsif valid then
   select * into ru from public.menu_item_modifier_rules where id=(m->>'rule_id')::uuid
    and menu_item_id=mi.id and organization_id=b.organization_id;
   -- A selected fountain flavor is an order preference, not observed syrup consumption.
   if inventory_reconciled and m->>'consumption_role'='preference_only' then continue; end if;
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
  'consumption_measurement',case when inventory_reconciled then 'inventory_reconciliation_required' else 'recipe_estimate' end,
  'consumption_notes',case when inventory_reconciled then jsonb_build_array(jsonb_build_object(
   'code','fountain_syrup_consumption_unmeasured',
   'detail','Flavor choice and refill quantities are not measured by this sale; do not interpret omitted syrup usage as zero consumption.'
  )) else '[]'::jsonb end,
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
 union all select 'menu_consumption_policies',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by menu_item_id),'')) from private.menu_sales_consumption_policies t join public.menu_items mi on mi.id=t.menu_item_id where mi.organization_id=p_org
 union all select 'units',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.units t
 )
 select md5('engine-v1.5-fountain-inventory-reconciled:'||string_agg(k||':'||h,',' order by k)) from hashes;
$function$;

do $block$
declare target public.menu_items%rowtype; modifier_uuid uuid;
begin
 select m.* into strict target from public.menu_items m join public.organizations o on o.id=m.organization_id
 where o.name='Hot Doogy Franchising Corporation' and m.name='Fountain Soda' and m.active;
 select id into modifier_uuid from public.modifiers where organization_id=target.organization_id and name='Fountain Soda' and active;
 if modifier_uuid is null then
  insert into public.modifiers(organization_id,name,default_effect_type,active) values(target.organization_id,'Fountain Soda','none',true) returning id into modifier_uuid;
 end if;
 insert into public.menu_item_modifier_rules(organization_id,menu_item_id,modifier_id,effect_type,action)
 select target.organization_id,target.id,modifier_uuid,'none','add'
 where not exists(select 1 from public.menu_item_modifier_rules where menu_item_id=target.id and modifier_id=modifier_uuid);
 insert into public.pos_modifier_mappings(organization_id,location_id,pos_source,external_modifier_name,modifier_id,active)
 select target.organization_id,lm.location_id,'square_csv','Fountain Soda',modifier_uuid,true
 from public.location_menu_items lm where lm.menu_item_id=target.id and lm.active
 and not exists(select 1 from public.pos_modifier_mappings pm where pm.organization_id=target.organization_id and pm.location_id=lm.location_id and pm.pos_source='square_csv' and private.restaurant_key(pm.external_modifier_name)=private.restaurant_key('Fountain Soda') and pm.active);
end $block$;

;
