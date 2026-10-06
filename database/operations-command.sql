-- Atomic commands bridge the web UI to canonical tables. Definer code lives in
-- private and authorizes the actor and every cross-table reference explicitly.
create table if not exists private.web_commands(command_id uuid primary key, actor uuid not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now());
revoke all on private.web_commands from public,anon,authenticated;
create table if not exists public.store_count_observations(
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 location_id uuid not null references public.locations(id),inventory_item_id uuid not null references public.inventory_items(id),
 item_unit_id uuid not null references public.inventory_item_units(id),quantity numeric not null check(quantity>=0 and quantity<'Infinity'::numeric),
 quantity_base numeric not null check(quantity_base>=0 and quantity_base<'Infinity'::numeric),
 counted_on date not null,moment text not null check(moment in ('Antes da abertura','Durante a operação','Após o fechamento')),
 session_id uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(session_id,inventory_item_id)
);
alter table public.store_count_observations enable row level security;
drop policy if exists scoped_read on public.store_count_observations;
create policy scoped_read on public.store_count_observations for select to authenticated using(private.is_org_member(organization_id) and private.can_location(location_id));
revoke all on public.store_count_observations from authenticated;
grant select on public.store_count_observations to authenticated;
create index if not exists store_count_observations_scope on public.store_count_observations(organization_id,location_id,inventory_item_id,counted_on desc);
revoke all on public.store_count_observations from anon;
create or replace function private.web_operation(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 org uuid:='6013ed02-626a-497c-b951-619069035532'; actor uuid:=auth.uid();
 id uuid; item uuid; loc uuid; vendor uuid; selected_unit uuid; area uuid; version_id uuid; quantity numeric; factor numeric;
 x jsonb; sh jsonb; v jsonb; result jsonb; old public.supplier_items%rowtype; old_order public.purchase_orders%rowtype; old_recipe public.recipe_versions%rowtype;
 u public.inventory_item_units%rowtype; ol public.purchase_order_lines%rowtype;
begin
 if actor is null or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Sem permissão para gravar esta operação.' using errcode='42501';end if;
 if p_action='catalog' then
  if jsonb_typeof(p->'shared'->'units') is distinct from 'array' then raise exception 'Unidades inválidas.';end if;
  id:=(p->>'id')::uuid;sh:=p->'shared';v:=p->'vendor';
  select * into old from public.supplier_items where supplier_items.id=id and organization_id=org for update;
  if not found or not private.can_supplier(old.supplier_id) then raise exception 'Cadastro não disponível.';end if;
  if old.updated_at is distinct from (p->>'expectedUpdatedAt')::timestamptz then raise exception 'Cadastro alterado por outra pessoa. Reabra antes de salvar.';end if;
  item:=old.inventory_item_id;
  perform 1 from public.inventory_items where inventory_items.id=item for update;
  if (select updated_at from public.inventory_items where inventory_items.id=item) is distinct from (p->>'expectedItemUpdatedAt')::timestamptz then raise exception 'Item alterado por outra pessoa. Reabra antes de salvar.';end if;
  if exists(select 1 from public.inventory_item_units z where z.inventory_item_id=item and not exists(select 1 from jsonb_array_elements(sh->'units') j where (j->>'id')::uuid=z.unit_id)) then raise exception 'Não é possível remover unidades já cadastradas; elas preservam o histórico.';end if;
  if not exists(select 1 from public.inventory_categories where inventory_categories.id=(sh->>'categoryId')::uuid and organization_id=org) then raise exception 'Categoria inválida.';end if;
  if (sh->>'baseUnitId')::uuid is distinct from (select base_unit_id from public.inventory_items where inventory_items.id=item) then raise exception 'A unidade-base não pode ser alterada após o cadastro.';end if;
  if jsonb_array_length(sh->'units') not between 1 and 100 then raise exception 'Unidades inválidas.';end if;
  for x in select value from jsonb_array_elements(sh->'units') loop
   quantity:=(x->>'factor')::numeric;if quantity is null or quantity<=0 or quantity>100000000 then raise exception 'Conversão inválida.';end if;
   if not exists(select 1 from public.units where units.id=(x->>'id')::uuid and (organization_id is null or organization_id=org)) then raise exception 'Unidade inválida.';end if;
   if (x->>'id')::uuid=(sh->>'baseUnitId')::uuid and quantity<>1 then raise exception 'A unidade-base deve ter fator 1.';end if;
   select * into u from public.inventory_item_units where inventory_item_id=item and unit_id=(x->>'id')::uuid for update;
   if found then
    update public.inventory_item_units set quantity_in_base_unit=quantity,is_count_unit=coalesce((x->>'stocktake')::boolean,false),is_base_unit=(x->>'id')::uuid=(sh->>'baseUnitId')::uuid where inventory_item_units.id=u.id;
   else
    insert into public.inventory_item_units(organization_id,inventory_item_id,unit_id,quantity_in_base_unit,is_base_unit,is_count_unit) values(org,item,(x->>'id')::uuid,quantity,false,coalesce((x->>'stocktake')::boolean,false));
   end if;
  end loop;
  update public.inventory_items set internal_name=sh->>'internalName',description=sh->>'description',category_id=(sh->>'categoryId')::uuid,active=(sh->>'active')::boolean,track_inventory=(sh->>'trackInventory')::boolean,yield_percent=(sh->>'yieldPercent')::numeric where inventory_items.id=item;
  if not exists(select 1 from public.inventory_item_units where inventory_item_id=item and unit_id=(v->>'orderingUnitId')::uuid) or not exists(select 1 from public.inventory_item_units where inventory_item_id=item and unit_id=(v->>'receivingUnitId')::uuid) then raise exception 'Unidades de compra e recebimento inválidas.';end if;
  update public.supplier_items set supplier_product_name=v->>'name',sku=v->>'sku',brand=v->>'brand',active=(v->>'supplierActive')::boolean,
   purchase_item_unit_id=(select inventory_item_units.id from public.inventory_item_units where inventory_item_id=item and unit_id=(v->>'orderingUnitId')::uuid),
   receive_item_unit_id=(select inventory_item_units.id from public.inventory_item_units where inventory_item_id=item and unit_id=(v->>'receivingUnitId')::uuid)
   where supplier_items.id=id;
  for x in select jsonb_build_object('location',key,'price',value) from jsonb_each(coalesce(v->'pricesByLocation','{}')) loop
   loc:=case when x->>'location'='all' then null else (x->>'location')::uuid end;
   if loc is not null and (not private.can_location(loc) or not exists(select 1 from public.locations where locations.id=loc and organization_id=org)) then raise exception 'Loja não autorizada.';end if;
   quantity:=(x->'price'->>'amount')::numeric;if quantity is null or quantity<0 or quantity>10000000 then raise exception 'Preço inválido.';end if;
   if (x->'price'->>'unitId')::uuid<>(v->>'orderingUnitId')::uuid then raise exception 'O preço deve usar a unidade de compra.';end if;
   insert into public.supplier_item_price_history(organization_id,location_id,supplier_item_id,price_per_purchase_unit,status,reviewed_by,reviewed_at) values(org,loc,id,quantity,'approved',actor,now());
  end loop;
 elsif p_action='orders' then
  if not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) then raise exception 'Sem permissão para compras.';end if;
  id:=(p->>'id')::uuid;loc:=(p->>'locationId')::uuid;vendor:=(p->>'supplierId')::uuid;
  if not private.can_location(loc) or not private.can_supplier(vendor) or not exists(select 1 from public.locations where locations.id=loc and organization_id=org and active) or not exists(select 1 from public.suppliers where suppliers.id=vendor and organization_id=org and active) then raise exception 'Loja ou fornecedor não autorizado.';end if;
  select * into old_order from public.purchase_orders where purchase_orders.id=id for update;
  if found then
   if old_order.organization_id<>org or old_order.location_id<>loc or old_order.supplier_id<>vendor or old_order.status<>'draft' or p->>'status'<>'ordered' then raise exception 'Transição de compra inválida.';end if;
   update public.purchase_orders set status='ordered',ordered_at=now() where purchase_orders.id=id;
  else
   if p->>'status'<>'draft' then raise exception 'Crie primeiro um rascunho.';end if;
   if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 200 then raise exception 'Informe os itens da compra.';end if;
   insert into public.purchase_orders(id,organization_id,location_id,supplier_id,status,order_number,expected_receive_at,created_by) values(id,org,loc,vendor,'draft',p->>'number',(p->>'expectedAt')::date::timestamp at time zone 'America/New_York',actor);
   for x in select value from jsonb_array_elements(p->'lines') loop
    item:=(x->>'itemId')::uuid;quantity:=(x->>'qty')::numeric;
    select * into u from public.inventory_item_units where inventory_item_units.id=(x->>'itemUnitId')::uuid and inventory_item_id=item and organization_id=org;
    if not found or quantity is null or quantity<=0 or quantity>100000000 then raise exception 'Quantidade ou unidade inválida.';end if;
    if not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=loc and active) then raise exception 'Item não habilitado nesta loja.';end if;
    select supplier_items.id into selected_unit from public.supplier_items where supplier_id=vendor and inventory_item_id=item and purchase_item_unit_id=u.id and active and organization_id=org order by supplier_items.id limit 1;
    if selected_unit is null then raise exception 'Item não disponível neste fornecedor/unidade.';end if;
    insert into public.purchase_order_lines(organization_id,purchase_order_id,supplier_item_id,inventory_item_id,purchase_item_unit_id,ordered_purchase_qty) values(org,id,selected_unit,item,u.id,quantity);
   end loop;
  end if;
 elsif p_action='receipt' then
  id:=(p->>'id')::uuid;
  select * into old_order from public.purchase_orders where purchase_orders.id=(p->>'orderId')::uuid and organization_id=org for update;
  if not found or not private.can_location(old_order.location_id) or not private.can_supplier(old_order.supplier_id) or not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) then raise exception 'Pedido não autorizado.';end if;
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 200 then raise exception 'Informe as quantidades recebidas.';end if;
  if (p->>'receivedAt')::timestamptz is null or (p->>'receivedAt')::timestamptz>now() then raise exception 'Data de recebimento inválida.';end if;
  if (select count(*) from jsonb_array_elements(p->'lines'))<>(select count(distinct value->>'lineId') from jsonb_array_elements(p->'lines')) then raise exception 'Linha repetida no recebimento.';end if;
  insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by) values(id,org,old_order.location_id,old_order.supplier_id,old_order.id,(p->>'receivedAt')::timestamptz,actor);
  for x in select value from jsonb_array_elements(p->'lines') loop
   select * into ol from public.purchase_order_lines where purchase_order_lines.id=(x->>'lineId')::uuid and purchase_order_id=old_order.id;
   if not found then raise exception 'Linha não pertence ao pedido.';end if;
   select * into u from public.inventory_item_units where inventory_item_units.id=ol.purchase_item_unit_id and inventory_item_id=ol.inventory_item_id;
   quantity:=(x->>'quantity')::numeric;area:=(x->>'areaId')::uuid;
   if u.id is null or quantity is null or quantity<=0 or quantity>100000000 or not private.can_storage(area) then raise exception 'Quantidade ou área inválida.';end if;
   if quantity+(select coalesce(sum(prl.quantity_received),0) from public.purchase_receipt_lines prl join public.purchase_receipts pr on pr.id=prl.receipt_id where prl.purchase_order_line_id=ol.id and pr.status='completed' and prl.received_item_unit_id=u.id)>ol.ordered_purchase_qty then raise exception 'Recebimento excede a quantidade pedida.';end if;
   insert into public.purchase_receipt_lines(organization_id,receipt_id,purchase_order_line_id,supplier_item_id,inventory_item_id,storage_area_id,received_item_unit_id,quantity_received,quantity_base) values(org,id,ol.id,ol.supplier_item_id,ol.inventory_item_id,area,u.id,quantity,quantity*u.quantity_in_base_unit);
  end loop;
  return public.confirm_purchase_receipt(id);
 elsif p_action='counts' then
  id:=(p->>'id')::uuid;loc:=(p->>'locationId')::uuid;
  if not private.can_location(loc) or not exists(select 1 from public.locations where locations.id=loc and organization_id=org) then raise exception 'Loja não autorizada.';end if;
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 500 then raise exception 'Contagem vazia.';end if;
  for x in select value from jsonb_array_elements(p->'lines') loop
   item:=(x->>'itemId')::uuid;quantity:=(x->>'qty')::numeric;
   select * into u from public.inventory_item_units where inventory_item_units.id=(x->>'itemUnitId')::uuid and inventory_item_id=item and organization_id=org and is_count_unit;
   if not found or quantity is null or quantity<0 or quantity>100000000 or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=loc and active) then raise exception 'Contagem inválida.';end if;
   insert into public.store_count_observations(id,organization_id,location_id,inventory_item_id,item_unit_id,quantity,quantity_base,counted_on,moment,session_id,created_by) values(gen_random_uuid(),org,loc,item,u.id,quantity,quantity*u.quantity_in_base_unit,(p->>'date')::date,p->>'moment',id,actor);
  end loop;
 elsif p_action='recipe' then
  if jsonb_typeof(p->'components') is distinct from 'array' or jsonb_array_length(p->'components') not between 1 and 200 then raise exception 'Componentes inválidos.';end if;
  id:=(p->>'id')::uuid;
  perform 1 from public.recipes where recipes.id=id and organization_id=org for update;if not found then raise exception 'Receita não encontrada.';end if;
  select * into old_recipe from public.recipe_versions where recipe_id=id order by version_number desc limit 1;
  if old_recipe.id is distinct from (p->>'expectedVersionId')::uuid then raise exception 'Receita alterada. Reabra antes de salvar.';end if;
  insert into public.recipe_versions(organization_id,recipe_id,version_number,status,yield_quantity,yield_item_unit_id,notes,created_by) values(org,id,old_recipe.version_number+1,'draft',old_recipe.yield_quantity,old_recipe.yield_item_unit_id,'Composição editada no aplicativo.',actor) returning recipe_versions.id into version_id;
  for x in select value from jsonb_array_elements(p->'components') loop
   item:=(x->>'itemId')::uuid;quantity:=(x->>'quantity')::numeric;
   select * into u from public.inventory_item_units where inventory_item_units.id=(x->>'itemUnitId')::uuid and inventory_item_id=item and organization_id=org;
   if not found or quantity is null or quantity<=0 or quantity>100000000 then raise exception 'Componente inválido.';end if;
   loc:=(x->>'locationId')::uuid;if loc is not null and not private.can_location(loc) then raise exception 'Loja não autorizada.';end if;
   insert into public.recipe_components(organization_id,recipe_version_id,component_inventory_item_id,component_item_unit_id,quantity,waste_percent,sort_order,notes,location_id,component_type)
   values(org,version_id,item,u.id,quantity,coalesce((x->>'wastePercent')::numeric,0),coalesce((x->>'sortOrder')::integer,0),x->>'notes',loc,coalesce(x->>'kind',x->>'componentType','ingredient'));
  end loop;
  insert into public.recipe_steps(recipe_version_id,step_number,title,instructions,media_path) select version_id,step_number,title,instructions,media_path from public.recipe_steps where recipe_version_id=old_recipe.id;
 elsif p_action='production' then
  perform pg_advisory_xact_lock(hashtextextended('prep:'||(p->>'id'),0));
  id:=(p->>'id')::uuid;loc:=(p->>'locationId')::uuid;item:=(p->>'itemId')::uuid;area:=(p->>'areaId')::uuid;
  if not private.can_location(loc) or not exists(select 1 from public.locations where locations.id=loc and organization_id=org) then raise exception 'Loja não autorizada.';end if;
  if not exists(select 1 from public.location_inventory_items where location_id=loc and inventory_item_id=item and active) then raise exception 'Preparação indisponível nesta loja.';end if;
  if area is null then select default_storage_area_id into area from public.location_inventory_items where location_id=loc and inventory_item_id=item;end if;
  if area is null then select case when count(*)=1 then (array_agg(storage_area_id))[1] end into area from public.inventory_item_storage_areas where inventory_item_id=item and location_id=loc;end if;
  if area is null or not private.can_storage(area) or not exists(select 1 from public.storage_areas where storage_areas.id=area and location_id=loc and organization_id=org and active) then raise exception 'Escolha a área de armazenamento da produção.';end if;
  select * into u from public.inventory_item_units where inventory_item_units.id=(p->>'itemUnitId')::uuid and inventory_item_id=item and organization_id=org;
  if not found then raise exception 'Unidade de produção inválida.';end if;
  quantity:=coalesce((p->>'actualQty')::numeric,(p->>'qty')::numeric);if quantity is null or quantity<=0 or quantity>100000000 then raise exception 'Quantidade inválida.';end if;
  version_id:=(p->>'recipeVersionId')::uuid;
  if not exists(select 1 from public.recipe_versions rv join public.recipes r on r.id=rv.recipe_id where rv.id=version_id and r.organization_id=org and r.output_inventory_item_id=item and r.active) then raise exception 'Receita de produção inválida.';end if;
  if p->>'status'='completed' and ((p->>'completedAt')::timestamptz is null or (p->>'completedAt')::timestamptz>now()) then raise exception 'Data de conclusão inválida.';end if;
  if exists(select 1 from public.prep_batches where prep_batches.id=id) then
   if not exists(select 1 from public.prep_batches where prep_batches.id=id and organization_id=org and location_id=loc and output_inventory_item_id=item and status in ('planned','in_progress')) or p->>'status'<>'completed' then raise exception 'Lote já concluído ou indisponível.';end if;
   update public.prep_batches set output_storage_area_id=area,actual_output_base=quantity*u.quantity_in_base_unit,status='completed',completed_at=(p->>'completedAt')::timestamptz,prepared_by=actor where prep_batches.id=id;
  else
  insert into public.prep_batches(id,organization_id,location_id,recipe_version_id,output_inventory_item_id,output_storage_area_id,status,planned_output_base,actual_output_base,completed_at,prepared_by,notes)
   values(id,org,loc,version_id,item,area,case when p->>'status'='completed' then 'completed'::public.prep_batch_status else 'planned'::public.prep_batch_status end,quantity*u.quantity_in_base_unit,case when p->>'status'='completed' then quantity*u.quantity_in_base_unit end,(p->>'completedAt')::timestamptz,actor,coalesce(p->>'notes','')||' | Registro de saída produzida; sem baixa automática de ingredientes.');
  end if;
  if p->>'status'='completed' then
   insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by) values(org,loc,area,item,'prep_production',quantity*u.quantity_in_base_unit,'prep_batch',id,(p->>'completedAt')::timestamptz,actor);
  end if;
 elsif p_action='invoices' then
  if not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) then raise exception 'Sem permissão para invoices.';end if;
  id:=(p->>'id')::uuid;loc:=(p->>'locationId')::uuid;vendor:=(p->>'supplierId')::uuid;
  if not private.can_location(loc) or not private.can_supplier(vendor) or not exists(select 1 from public.locations where locations.id=loc and organization_id=org) or not exists(select 1 from public.suppliers where suppliers.id=vendor and organization_id=org) then raise exception 'Loja ou fornecedor não autorizado.';end if;
  insert into public.invoices(id,organization_id,location_id,supplier_id,invoice_number,invoice_date,due_date,total,created_by) values(id,org,loc,vendor,p->>'number',(p->>'date')::date,(p->>'dueDate')::date,(p->>'total')::numeric,actor);
 elsif p_action='transfer_step' then
  if p->>'step' not in ('approve','dispatch','receive','cancel','reject','close_partial') then raise exception 'Etapa inválida.';end if;
  return private.internal_request_command((p->>'commandId')::uuid,p->>'step',p->'data');
 elsif p_action='transfers' then
  if p->>'status'<>'draft' then raise exception 'Use a conferência de expedição e recebimento para avançar transferências.';end if;
  select jsonb_agg(jsonb_build_object('inventory_item_id',value->>'itemId','item_unit_id',value->>'itemUnitId','quantity',value->'qty')) into x from jsonb_array_elements(p->'lines');
  return private.internal_request_command((p->>'id')::uuid,'create',jsonb_build_object('requesting_location_id',p->>'toLocationId','fulfilling_location_id',p->>'fromLocationId','needed_on',p->>'date','notes',coalesce(nullif(btrim(p->>'notes'),''),p->>'number'),'lines',x));
 else raise exception 'Operação ainda não conectada: %',p_action;
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,new_data) values(org,actor,'web_save',p_action,id,jsonb_build_object('saved_at',now()));
 return jsonb_build_object('id',id,'saved',true);
end $$;
revoke all on function private.web_operation(text,jsonb) from public,anon,authenticated;
create or replace function private.web_command(p_command_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare canonical jsonb; old private.web_commands%rowtype; x jsonb; results jsonb:='[]';
begin
 if auth.uid() is null or not private.has_org_role('6013ed02-626a-497c-b951-619069035532',array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Sem permissão.' using errcode='42501';end if;
 if p_command_id is null or p_action<>'batch' or jsonb_typeof(p_payload->'changes') is distinct from 'array' or jsonb_array_length(p_payload->'changes') not between 1 and 100 then raise exception 'Comando inválido.';end if;
 canonical:=jsonb_build_object('actor',auth.uid(),'action',p_action,'payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into old from private.web_commands where command_id=p_command_id;
 if found then if old.payload<>canonical then raise exception 'Comando reutilizado com dados diferentes.';end if;return old.result;end if;
 for x in select value from jsonb_array_elements(p_payload->'changes') loop results:=results||jsonb_build_array(private.web_operation(x->>'action',x->'payload'));end loop;
 insert into private.web_commands(command_id,actor,payload,result) values(p_command_id,auth.uid(),canonical,results);
 return results;
end $$;
revoke all on function private.web_command(uuid,text,jsonb) from public,anon;
grant execute on function private.web_command(uuid,text,jsonb) to authenticated;
create or replace function public.operations_command(p_command_id uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.web_command(p_command_id,p_action,p_payload)$$;
revoke all on function public.operations_command(uuid,text,jsonb) from public,anon;
grant execute on function public.operations_command(uuid,text,jsonb) to authenticated;
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
