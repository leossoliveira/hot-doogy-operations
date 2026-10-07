
create function private.resolve_square_csv_modifiers(p_org uuid,p_location uuid,p_menu uuid,p_text text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare token text; ordinal integer:=0; result jsonb:='[]'; candidates jsonb;
begin
 for token in select btrim(x) from unnest(string_to_array(coalesce(p_text,''),',')) x where btrim(x)<>'' loop
 ordinal:=ordinal+1;
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into candidates from (
 select distinct r.id as rule_id,m.id as modifier_id,rec.id as recipe_id,r.action,r.price as catalog_price
 from public.menu_item_modifier_rules r
 join public.modifiers m on m.id=r.modifier_id and m.active and m.organization_id=p_org
 join public.recipes rec on rec.id=coalesce(r.recipe_id,m.default_recipe_id)
   and rec.organization_id=p_org and rec.classification='modifier_recipe' and rec.active
 where r.organization_id=p_org and r.menu_item_id=p_menu and (
 exists(select 1 from public.pos_modifier_mappings pm where pm.organization_id=p_org
 and pm.location_id=p_location and pm.pos_source='square_csv' and pm.active
 and pm.modifier_id=m.id and lower(btrim(pm.external_modifier_name))=lower(token))
 or lower(btrim(m.name))=lower(token))
 ) c;
 result:=result || jsonb_build_array(jsonb_build_object('position',ordinal,'source_name',token,
 'status',case when jsonb_array_length(candidates)=1 then 'linked' else 'pending' end)
 || case when jsonb_array_length(candidates)=1 then candidates->0
 else jsonb_build_object('reason',case when jsonb_array_length(candidates)=0 then 'Modifier recipe mapping required for this menu item' else 'Ambiguous modifier action or recipe' end) end);
 end loop;
 return result;
end $$;
revoke all on function private.resolve_square_csv_modifiers(uuid,uuid,uuid,text) from public;
grant execute on function private.resolve_square_csv_modifiers(uuid,uuid,uuid,text) to authenticated;

do $$
declare def text;
begin
 def:=pg_get_functiondef('private.prepare_square_csv_import_row()'::regprocedure);
 def:=replace(def,'begin' || chr(10) || '  select b.organization_id',
 'begin' || chr(10) || '  if not exists (select 1 from public.sales_import_batches where id=new.batch_id and pos_source=''square_csv'' and import_type=''item_sales'') then return new; end if;' || chr(10) || '  select b.organization_id');
 def:=replace(def,'''SKU'', new.raw_data->>''SKU'',','''SKU'', new.raw_data->>''SKU'',
    ''Modifiers Applied'', new.raw_data->>''Modifiers Applied'',');
 def:=replace(def,'  new.error_message :=','
  new.normalized_data := new.normalized_data || jsonb_build_object(''modifiers'',
    private.resolve_square_csv_modifiers(v_org_id,v_location_id,v_menu_item_id,new.raw_data->>''Modifiers Applied''));
  if exists(select 1 from jsonb_array_elements(new.normalized_data->''modifiers'') x where x->>''status''=''pending'') then
    v_errors:=array_append(v_errors,''Modifier recipe mapping required'');
  end if;
  new.error_message :=');
 execute def;
 def:=pg_get_functiondef('public.process_square_csv_batch(uuid)'::regprocedure);
 def:=replace(def,'''price_point_name'', r.normalized_data->>''price_point_name'',',
 '''modifiers'', r.normalized_data->''modifiers'',
      ''price_point_name'', r.normalized_data->>''price_point_name'',');
 execute def;
end $$;
-- Invoker trigger calls these helpers on authenticated imports.
grant execute on function private.square_csv_resolved_item_name(text,text),private.square_csv_numeric(text),private.square_csv_timestamp(text,text,text) to authenticated;
comment on function private.resolve_square_csv_modifiers(uuid,uuid,uuid,text) is
'CSV only: preserve repeated occurrences; resolve only a unique recipe/action for the sold menu item. Catalog price is reference, not historical charge. Unknown/ambiguous modifiers require review.';

;
