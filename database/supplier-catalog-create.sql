-- Apply after remove-inventory-catalog-name.sql.
alter table public.suppliers add column if not exists contact_name text,
 add column if not exists email text, add column if not exists phone text,
 add column if not exists address text, add column if not exists city text,
 add column if not exists region text, add column if not exists postal_code text,
 add column if not exists country text, add column if not exists tax_id text,
 add column if not exists account_number text, add column if not exists payment_terms text;
create or replace function private.catalog_create(p_kind text,p_payload jsonb,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; actor uuid:=auth.uid(); p jsonb:=p_payload;
 canonical jsonb; previous private.web_commands%rowtype; result jsonb; item uuid; supplier uuid; item_unit uuid;
 base_unit uuid; order_unit uuid; count_unit uuid; order_factor numeric; count_factor numeric; category uuid;
 x jsonb; loc uuid; area uuid; unit_row record; price numeric;
begin
 if actor is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) then raise exception 'Catalog access denied' using errcode='42501';end if;
 if p_command_id is null or p_kind not in ('supplier','item') or jsonb_typeof(p) is distinct from 'object' then raise exception 'Invalid catalog request';end if;
 canonical:=jsonb_build_object('kind',p_kind,'payload',p);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into previous from private.web_commands where command_id=p_command_id;
 if found then
  if previous.actor<>actor or previous.payload<>canonical then raise exception 'Command ID already used';end if;
  return previous.result;
 end if;
 if nullif(btrim(p->>'name'),'') is null then raise exception 'Name is required';end if;
 category:=nullif(p->>'categoryId','')::uuid;
 if p_kind='supplier' then
  if category is not null and not exists(select 1 from public.supplier_categories where id=category and organization_id=org) then raise exception 'Invalid supplier category';end if;
  if exists(select 1 from public.suppliers where organization_id=org and lower(btrim(name))=lower(btrim(p->>'name'))) then raise exception 'A supplier with this name already exists';end if;
  insert into public.suppliers(organization_id,name,category_id,website_url,default_order_method,order_url,notes,contact_name,email,phone,address,city,region,postal_code,country,tax_id,account_number,payment_terms)
  values(org,btrim(p->>'name'),category,nullif(p->>'websiteUrl',''),nullif(p->>'orderMethod','')::public.order_method,nullif(p->>'orderUrl',''),p->>'notes',p->>'contactName',p->>'email',p->>'phone',p->>'address',p->>'city',p->>'region',p->>'postalCode',p->>'country',p->>'taxId',p->>'accountNumber',p->>'paymentTerms') returning id into supplier;
  result:=jsonb_build_object('id',supplier);
 else
  supplier:=(p->>'supplierId')::uuid;base_unit:=(p->>'baseUnitId')::uuid;order_unit:=(p->>'orderUnitId')::uuid;count_unit:=(p->>'countUnitId')::uuid;
  order_factor:=(p->>'orderFactor')::numeric;count_factor:=(p->>'countFactor')::numeric;
  if not private.can_supplier(supplier) or not exists(select 1 from public.suppliers where id=supplier and organization_id=org and active) then raise exception 'Supplier unavailable';end if;
  if nullif(btrim(p->>'internalName'),'') is null then raise exception 'Internal name is required';end if;
  if category is null or not exists(select 1 from public.inventory_categories where id=category and organization_id=org) then raise exception 'Invalid item category';end if;
  if base_unit is null or order_unit is null or count_unit is null or (select count(*) from public.units where id=any(array[base_unit,order_unit,count_unit]) and (organization_id is null or organization_id=org))<>(select count(distinct u) from unnest(array[base_unit,order_unit,count_unit]) u) then raise exception 'Invalid units';end if;
  if order_factor is null or count_factor is null or order_factor<=0 or count_factor<=0 or order_factor>100000000 or count_factor>100000000 then raise exception 'Enter positive, finite conversions';end if;
  if (base_unit=order_unit and order_factor<>1) or (base_unit=count_unit and count_factor<>1) or (order_unit=count_unit and order_factor<>count_factor) then raise exception 'Conversions for the same unit must match; base unit conversion must be 1';end if;
  if jsonb_typeof(p->'locations') is distinct from 'array' or jsonb_array_length(p->'locations')<1 then raise exception 'Select at least one location';end if;
  if nullif(btrim(p->>'sku'),'') is not null and exists(select 1 from public.supplier_items where supplier_id=supplier and lower(btrim(sku))=lower(btrim(p->>'sku'))) then raise exception 'This SKU already exists for the supplier';end if;
  insert into public.inventory_items(organization_id,internal_name,category_id,item_type,base_unit_id,description) values(org,btrim(p->>'internalName'),category,'purchased',base_unit,p->>'notes') returning id into item;
  for unit_row in select distinct on (u) u,f from (values(base_unit,1::numeric),(order_unit,order_factor),(count_unit,count_factor)) units(u,f) loop
   insert into public.inventory_item_units(organization_id,inventory_item_id,unit_id,quantity_in_base_unit,is_base_unit,is_purchase_unit,is_receive_unit,is_count_unit)
   values(org,item,unit_row.u,unit_row.f,unit_row.u=base_unit,unit_row.u=order_unit,unit_row.u=order_unit,unit_row.u=count_unit);
  end loop;
  for x in select value from jsonb_array_elements(p->'locations') loop
   loc:=(x->>'id')::uuid;area:=(x->>'areaId')::uuid;
   if not private.can_location(loc) or not private.can_storage(area) or not exists(select 1 from public.locations where id=loc and organization_id=org and active) or not exists(select 1 from public.storage_areas where id=area and location_id=loc and organization_id=org and active) then raise exception 'Invalid location or storage area';end if;
   insert into public.location_inventory_items(organization_id,location_id,inventory_item_id,default_storage_area_id) values(org,loc,item,area);
   insert into public.inventory_item_storage_areas(organization_id,location_id,inventory_item_id,storage_area_id) values(org,loc,item,area);
  end loop;
  select id into item_unit from public.inventory_item_units where inventory_item_id=item and unit_id=order_unit;
  insert into public.supplier_items(organization_id,supplier_id,inventory_item_id,supplier_product_name,brand,sku,purchase_item_unit_id,receive_item_unit_id,product_url)
  values(org,supplier,item,btrim(p->>'name'),p->>'brand',nullif(btrim(p->>'sku'),''),item_unit,item_unit,nullif(p->>'productUrl','')) returning id into supplier;
  price:=nullif(p->>'price','')::numeric;
  if price is not null then
   if price<0 or price>10000000 then raise exception 'Invalid price';end if;
   insert into public.supplier_item_price_history(organization_id,supplier_item_id,price_per_purchase_unit,status,reviewed_by,reviewed_at) values(org,supplier,price,'approved',actor,now());
  end if;
  result:=jsonb_build_object('id',supplier,'itemId',item);
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,new_data) values(org,actor,'catalog.create',p_kind,(result->>'id')::uuid,result);
 insert into private.web_commands(command_id,actor,payload,result) values(p_command_id,actor,canonical,result);
 return result;
end $$;
revoke all on function private.catalog_create(text,jsonb,uuid) from public,anon;
grant execute on function private.catalog_create(text,jsonb,uuid) to authenticated;
create or replace function public.catalog_create(p_kind text,p_payload jsonb,p_command_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.catalog_create(p_kind,p_payload,p_command_id);$$;
revoke all on function public.catalog_create(text,jsonb,uuid) from public,anon;
grant execute on function public.catalog_create(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
