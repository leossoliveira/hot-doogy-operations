-- No historical backfill: completed/partial legacy batches require explicit reconciliation.
create table private.preparation_records (
 batch_id uuid primary key references public.prep_batches(id), payload jsonb not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table private.preparation_records enable row level security;
revoke all on private.preparation_records from public,anon,authenticated,service_role;

-- Validate persisted evidence on retry; returning an old success alone is insufficient.
create function private.verify_preparation(p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.prep_batches%rowtype; m jsonb; c jsonb;
begin
 select * into b from public.prep_batches where id=(p_result->>'id')::uuid;
 if not found or b.status is distinct from 'completed'::public.prep_batch_status or b.location_id is distinct from (p_result->>'locationId')::uuid
 or b.output_inventory_item_id is distinct from (p_result->>'itemId')::uuid
 or b.output_storage_area_id is distinct from (p_result->>'areaId')::uuid
 or b.actual_output_base is distinct from (p_result->>'quantityBase')::numeric
 or b.recipe_version_id is distinct from (p_result->>'recipeVersionId')::uuid
 or b.completed_at is distinct from (p_result->>'completedAt')::timestamptz
 or b.prepared_team_member_id is distinct from nullif(p_result->>'preparedTeamMemberId','')::uuid then raise exception 'Recorded preparation no longer matches; reconciliation required.';end if;
 if (select count(*) from public.inventory_transactions where source_type='prep_batch' and source_id=b.id)<>jsonb_array_length(p_result->'movements')
 or (select count(*) from public.prep_batch_components where prep_batch_id=b.id)<>jsonb_array_length(p_result->'components') then raise exception 'Recorded preparation evidence count changed; reconciliation required.';end if;
 for m in select value from jsonb_array_elements(p_result->'movements') loop
  if not exists(select 1 from public.inventory_transactions t where t.id=(m->>'id')::uuid and t.organization_id=b.organization_id and t.location_id=b.location_id and t.source_type='prep_batch' and t.source_id=b.id and t.inventory_item_id=(m->>'itemId')::uuid and t.storage_area_id=(m->>'areaId')::uuid and t.transaction_type::text=m->>'type' and t.quantity_base=(m->>'quantityBase')::numeric) then raise exception 'Recorded preparation movement changed; reconciliation required.';end if;
 end loop;
 for c in select value from jsonb_array_elements(p_result->'components') loop
  if not exists(select 1 from public.prep_batch_components x where x.id=(c->>'id')::uuid and x.organization_id=b.organization_id and x.prep_batch_id=b.id and x.inventory_item_id=(c->>'itemId')::uuid and x.storage_area_id=(c->>'areaId')::uuid and x.planned_quantity_base=(c->>'quantityBase')::numeric and x.actual_quantity_base=(c->>'quantityBase')::numeric) then raise exception 'Recorded preparation component changed; reconciliation required.';end if;
 end loop;
end $$;
revoke all on function private.verify_preparation(jsonb) from public,anon,authenticated,service_role;

create function private.complete_preparation(p jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org constant uuid:='6013ed02-626a-497c-b951-619069035532';
 bid uuid:=(p->>'id')::uuid; loc uuid:=(p->>'locationId')::uuid;
 item uuid:=(p->>'itemId')::uuid; area uuid:=(p->>'areaId')::uuid;
 vid uuid:=(p->>'recipeVersionId')::uuid; team uuid:=nullif(p->>'preparedTeamMemberId','')::uuid;
 stamp timestamptz:=(p->>'completedAt')::timestamptz;
 qty numeric:=coalesce((p->>'actualQty')::numeric,(p->>'qty')::numeric);
 output_base numeric; yield_base numeric; amount numeric; ingredient_area uuid;
 member_name text; tx uuid; cid uuid; c record; b public.prep_batches%rowtype;
 prior private.preparation_records%rowtype; canonical jsonb; movements jsonb:='[]'; components jsonb:='[]'; result jsonb;
begin
 if bid is null or p->>'status' is distinct from 'completed' then raise exception 'Completed batch ID required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('prep:'||bid,0));
 canonical:=jsonb_build_object('actor',p_actor,'payload',p);
 select * into prior from private.preparation_records where batch_id=bid;
 if found then
  if prior.payload<>canonical then raise exception 'Batch already recorded with different payload; reconcile with Leonardo.';end if;
  perform private.verify_preparation(prior.result);return prior.result;
 end if;
 if qty is null or qty<=0 or qty>100000000 or qty::text in ('NaN','Infinity','-Infinity') or stamp is null or not isfinite(stamp) or stamp>now() or stamp<date '2000-01-01' then raise exception 'Invalid production quantity or completion date.';end if;
 if not exists(select 1 from public.locations where id=loc and organization_id=org and active)
 or not exists(select 1 from public.location_inventory_items l join public.inventory_items i on i.id=l.inventory_item_id where l.location_id=loc and i.id=item and l.active and i.active and i.organization_id=org) then raise exception 'Preparation unavailable at this location.';end if;
 if p_actor is not null and not private.can_location(loc) then raise exception 'Unauthorized production location.' using errcode='42501';end if;
 if area is null then select default_storage_area_id into area from public.location_inventory_items where location_id=loc and inventory_item_id=item;end if;
 if area is null then select case when count(*)=1 then (array_agg(storage_area_id))[1] end into area from public.inventory_item_storage_areas where location_id=loc and inventory_item_id=item;end if;
 if not exists(select 1 from public.storage_areas s join public.inventory_item_storage_areas a on a.storage_area_id=s.id where s.id=area and s.organization_id=org and s.location_id=loc and s.active and a.inventory_item_id=item and a.location_id=loc)
 or (p_actor is not null and not private.can_storage(area)) then raise exception 'Invalid or ambiguous production storage area.';end if;
 select qty*u.quantity_in_base_unit into output_base from public.inventory_item_units u where u.id=(p->>'itemUnitId')::uuid and u.inventory_item_id=item and u.organization_id=org and u.quantity_in_base_unit>0;
 if output_base is null or output_base<=0 or output_base>1000000000 or round(output_base,6)<>output_base then raise exception 'Invalid production unit or precision.';end if;
 -- Lock the chosen version; the output and yield units must belong to the right items.
 perform 1 from public.recipe_versions where id=vid for share;
 select v.yield_quantity*u.quantity_in_base_unit into yield_base from public.recipe_versions v join public.recipes r on r.id=v.recipe_id join public.inventory_item_units u on u.id=v.yield_item_unit_id and u.inventory_item_id=item and u.organization_id=org
 where v.id=vid and v.organization_id=org and v.status='active' and r.organization_id=org and r.active and r.classification='prep_recipe' and r.output_inventory_item_id=item
 and (r.production_location_id=loc or exists(select 1 from public.recipe_production_locations l where l.recipe_id=r.id and l.location_id=loc and l.organization_id=org))
 and (select count(*) from public.recipe_versions z where z.recipe_id=r.id and z.status='active')=1;
 if yield_base is null or yield_base<=0 or yield_base>1000000000 then raise exception 'A unique active preparation recipe with valid yield is required.';end if;
 if team is not null then
  select btrim(concat_ws(' ',first_name,last_name)) into member_name from public.hr_team_members where id=team and organization_id=org and status='active' and loc=any(location_ids);
  if nullif(member_name,'') is null then raise exception 'Active preparer assigned to production location required.';end if;
 elsif p_actor is null then raise exception 'Explicit preparer required for agent production.';end if;
 select * into b from public.prep_batches where id=bid for update;
 if found and (b.status not in ('planned','in_progress') or b.organization_id<>org or b.location_id<>loc or b.output_inventory_item_id<>item or b.recipe_version_id<>vid) then raise exception 'Batch unavailable or already completed; reconciliation required.';end if;
 if exists(select 1 from public.prep_batch_components where prep_batch_id=bid) or exists(select 1 from public.inventory_transactions where source_id=bid and source_type='prep_batch') then raise exception 'Preexisting batch movements require reconciliation.';end if;
 -- Same item ordering as dispatch availability checks; no recipe recursion/double consumption.
 perform i.id from public.inventory_items i where i.id=item or i.id in (select component_inventory_item_id from public.recipe_components where recipe_version_id=vid and (location_id is null or location_id=loc)) order by i.id for update;
 if b.id is null then
  insert into public.prep_batches(id,organization_id,location_id,recipe_version_id,output_inventory_item_id,output_storage_area_id,status,planned_output_base,actual_output_base,completed_at,prepared_by,notes,prepared_team_member_id,prepared_team_member_name)
  values(bid,org,loc,vid,item,area,'completed',output_base,output_base,stamp,p_actor,p->>'notes',team,member_name);
 else
  update public.prep_batches set status='completed',output_storage_area_id=area,actual_output_base=output_base,completed_at=stamp,prepared_by=p_actor,prepared_team_member_id=coalesce(team,prepared_team_member_id),prepared_team_member_name=coalesce(member_name,prepared_team_member_name) where id=bid;
 end if;
 for c in select rc.*,u.quantity_in_base_unit,i.active as item_active,u.inventory_item_id as unit_item,u.organization_id as unit_org
 from public.recipe_components rc left join public.inventory_item_units u on u.id=rc.component_item_unit_id left join public.inventory_items i on i.id=rc.component_inventory_item_id and i.organization_id=org
 where rc.recipe_version_id=vid and (rc.location_id is null or rc.location_id=loc) order by rc.sort_order,rc.id loop
  if c.organization_id<>org or c.component_inventory_item_id=item or c.item_active is distinct from true or c.unit_item is distinct from c.component_inventory_item_id or c.unit_org is distinct from org
  or c.quantity is null or c.quantity<=0 or c.quantity>1000000000 or c.quantity_in_base_unit is null or c.quantity_in_base_unit<=0 or c.quantity_in_base_unit>1000000000 or c.waste_percent is null or c.waste_percent<0 or c.waste_percent>=1
  or not exists(select 1 from public.location_inventory_items where location_id=loc and inventory_item_id=c.component_inventory_item_id and active) then raise exception 'Invalid active recipe component or unit.';end if;
  ingredient_area:=null;
  select default_storage_area_id into ingredient_area from public.location_inventory_items where inventory_item_id=c.component_inventory_item_id and location_id=loc;
  if ingredient_area is null then select case when count(*)=1 then (array_agg(storage_area_id))[1] end into ingredient_area from public.inventory_item_storage_areas where inventory_item_id=c.component_inventory_item_id and location_id=loc;end if;
  if not exists(select 1 from public.storage_areas s join public.inventory_item_storage_areas a on a.storage_area_id=s.id where s.id=ingredient_area and s.active and s.location_id=loc and s.organization_id=org and a.inventory_item_id=c.component_inventory_item_id and a.location_id=loc)
  or (p_actor is not null and not private.can_storage(ingredient_area)) then raise exception 'Invalid or ambiguous ingredient storage area.';end if;
  amount:=round(output_base/yield_base*c.quantity*c.quantity_in_base_unit/(1-c.waste_percent),6);
  if amount is null or amount<=0 or amount>1000000000 then raise exception 'Invalid ingredient consumption quantity.';end if;
  if (select coalesce(sum(quantity_base),0) from public.inventory_transactions where location_id=loc and storage_area_id=ingredient_area and inventory_item_id=c.component_inventory_item_id)<amount then raise exception 'Insufficient ingredient stock in production storage area.';end if;
  insert into public.prep_batch_components(organization_id,prep_batch_id,inventory_item_id,storage_area_id,planned_quantity_base,actual_quantity_base) values(org,bid,c.component_inventory_item_id,ingredient_area,amount,amount) returning id into cid;
  insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by) values(org,loc,ingredient_area,c.component_inventory_item_id,'prep_consumption',-amount,'prep_batch',bid,stamp,p_actor) returning id into tx;
  components:=components||jsonb_build_array(jsonb_build_object('id',cid,'itemId',c.component_inventory_item_id,'areaId',ingredient_area,'quantityBase',amount));
  movements:=movements||jsonb_build_array(jsonb_build_object('id',tx,'itemId',c.component_inventory_item_id,'areaId',ingredient_area,'type','prep_consumption','quantityBase',-amount));
 end loop;
 if jsonb_array_length(components)=0 then raise exception 'Active recipe has no components at production location.';end if;
 insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by) values(org,loc,area,item,'prep_production',output_base,'prep_batch',bid,stamp,p_actor) returning id into tx;
 movements:=movements||jsonb_build_array(jsonb_build_object('id',tx,'itemId',item,'areaId',area,'type','prep_production','quantityBase',output_base));
 select * into b from public.prep_batches where id=bid;
 result:=jsonb_build_object('id',bid,'saved',true,'locationId',loc,'itemId',item,'areaId',area,'recipeVersionId',vid,'quantityBase',output_base,'completedAt',b.completed_at,'preparedTeamMemberId',b.prepared_team_member_id,'components',components,'movements',movements);
 perform private.verify_preparation(result);
 insert into private.preparation_records(batch_id,payload,result) values(bid,canonical,result);
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,loc,p_actor,'production.completed','prep_batch',bid,result);
 return result;
end $$;
revoke all on function private.complete_preparation(jsonb,uuid) from public,anon,authenticated,service_role;

-- Preserve the human MFA/profile checks and planned-batch flow; replace completion only.
do $$ declare definition text; anchor constant text:=$a$elsif p_action='production' then$a$;begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if strpos(definition,anchor)=0 then raise exception 'Unexpected production function; review migration.';end if;
 definition:=replace(definition,anchor,anchor||E'\n  if p->>''status''=''completed'' then return private.complete_preparation(p,actor);end if;');
 definition:=replace(definition,$a$coalesce(p->>'notes','')||' | Registro de saída produzida; sem baixa automática de ingredientes.'$a$,$a$coalesce(p->>'notes','')$a$);
 execute definition;
 definition:=pg_get_functiondef('private.web_command(uuid,text,jsonb)'::regprocedure);
 if strpos(definition,'return old.result;')=0 then raise exception 'Unexpected command retry function; review migration.';end if;
 definition:=replace(definition,'return old.result;',E'for x in select value from jsonb_array_elements(p_payload->''changes'') loop\n if x->>''action''=''production'' and x->''payload''->>''status''=''completed'' then\n perform private.verify_preparation((select result from private.preparation_records where batch_id=(x->''payload''->>''id'')::uuid));end if;\n end loop;return old.result;');
 execute definition;
end $$;

-- A distinct machine identity. Provision LOGIN/password separately, never in this migration.
create role doogy_prep_service nologin noinherit;
grant usage on schema doogy_operations to doogy_prep_service;
create table doogy_operations.preparation_commands (
 group_id text not null,message_id text not null,payload jsonb not null,result jsonb not null,
 entity_id uuid not null,kind text not null,created_at timestamptz not null default now(),primary key(group_id,message_id)
);
alter table doogy_operations.preparation_commands enable row level security;
revoke all on doogy_operations.preparation_commands from public,anon,authenticated,service_role,doogy_prep_service;

create function private.prep_transfer_scope(p_org uuid,p_location uuid,p_storage uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_org is distinct from '6013ed02-626a-497c-b951-619069035532'::uuid
 or p_location is null or p_location not in ('a74401ec-ce6e-4df4-ad5d-71ce11af4351'::uuid,'d61fa7fe-fbe7-41cd-b45c-6527fae9b6b6'::uuid)
 or not exists(select 1 from public.locations where id=p_location and organization_id=p_org and active)
 or (p_storage is not null and not exists(select 1 from public.storage_areas where id=p_storage and location_id=p_location and organization_id=p_org and active)) then raise exception 'Outside preparation transfer scope.' using errcode='42501';end if;
end $$;
revoke all on function private.prep_transfer_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Reuse the installed transfer state machine, locks, limits and stock validation. Do not
-- weaken its human authorization or fabricate auth.uid()/JWT claims for the machine.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('private.internal_request_command(uuid,text,jsonb)'::regprocedure);
 if strpos(definition,'private.internal_request_authorize(')=0 or strpos(definition,'auth.uid()')=0 then raise exception 'Unexpected internal request function; review migration.';end if;
 definition:=replace(definition,'FUNCTION private.internal_request_command(','FUNCTION private.prep_internal_request_command(');
 definition:=replace(definition,'private.internal_request_authorize(','private.prep_transfer_scope(');
 definition:=replace(definition,'auth.uid()','null::uuid');
 execute definition;
end $$;
revoke all on function private.prep_internal_request_command(uuid,text,jsonb) from public,anon,authenticated,service_role,doogy_prep_service;

create function private.verify_preparation_transfer(p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare m jsonb;l jsonb;expected_count integer;
begin
 if not exists(select 1 from public.internal_requests r where r.id=(p_result->>'request_id')::uuid and r.organization_id='6013ed02-626a-497c-b951-619069035532' and r.requesting_location_id=(p_result->>'requestingLocationId')::uuid and r.fulfilling_location_id=(p_result->>'fulfillingLocationId')::uuid) then raise exception 'Transfer no longer matches; reconciliation required.';end if;
 if (select count(*) from public.internal_request_lines where request_id=(p_result->>'request_id')::uuid)<>jsonb_array_length(p_result->'lines') then raise exception 'Transfer lines changed; reconciliation required.';end if;
 for l in select value from jsonb_array_elements(p_result->'lines') loop
  if not exists(select 1 from public.internal_request_lines r where r.id=(l->>'id')::uuid and r.request_id=(p_result->>'request_id')::uuid and r.inventory_item_id=(l->>'inventory_item_id')::uuid and r.item_unit_id=(l->>'item_unit_id')::uuid and r.unit_factor=(l->>'unit_factor')::numeric and r.requested_quantity=(l->>'requested_quantity')::numeric) then raise exception 'Transfer line no longer matches; reconciliation required.';end if;
 end loop;
 if p_result->>'action'='dispatch' then
  select count(*) into expected_count from public.inventory_transactions t join public.interstore_transfer_lines l on l.id=t.source_id where l.transfer_id=(p_result->>'document_id')::uuid and t.source_type='interstore_dispatch';
 elsif p_result->>'action'='receive' then
  select count(*) into expected_count from public.inventory_transactions t join public.interstore_receipt_lines l on l.id=t.source_id where l.receipt_id=(p_result->>'document_id')::uuid and t.source_type='interstore_receipt';
 else expected_count:=0;end if;
 if expected_count<>jsonb_array_length(p_result->'movements') then raise exception 'Transfer movement count changed; reconciliation required.';end if;
 for m in select value from jsonb_array_elements(p_result->'movements') loop
  if not exists(select 1 from public.inventory_transactions t where t.id=(m->>'id')::uuid and t.source_id=(m->>'sourceId')::uuid and t.source_type=m->>'sourceType' and t.transaction_type::text=m->>'type' and t.inventory_item_id=(m->>'itemId')::uuid and t.location_id=(m->>'locationId')::uuid and t.storage_area_id=(m->>'areaId')::uuid and t.quantity_base=(m->>'quantityBase')::numeric) then raise exception 'Transfer movement no longer matches; reconciliation required.';end if;
 end loop;
end $$;
revoke all on function private.verify_preparation_transfer(jsonb) from public,anon,authenticated,service_role,doogy_prep_service;

create function doogy_operations.record_whatsapp_preparation(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org constant uuid:='6013ed02-626a-497c-b951-619069035532';
 plaza constant uuid:='a74401ec-ce6e-4df4-ad5d-71ce11af4351'; mall constant uuid:='d61fa7fe-fbe7-41cd-b45c-6527fae9b6b6';
 grp text:=p->>'groupId';msg text:=p->>'messageId';kind text:=p->>'kind';step text:=p->>'step';
 old doogy_operations.preparation_commands%rowtype; result jsonb; data jsonb:=p->'data';
 bid uuid:=gen_random_uuid(); req uuid; ln record; moves jsonb; lines jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or coalesce(p->>'agentId','')<>'doogy-food-prep' or grp is distinct from '120363380724268297@g.us' then raise exception 'Unauthorized preparation agent or group.' using errcode='42501';end if;
 if msg is null or msg !~ '^[A-Za-z0-9_-]{8,128}$' or coalesce(p->>'sourceSha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Verified source message required.';end if;
 if jsonb_typeof(data) is distinct from 'object' then raise exception 'Operation data required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('prep-source:'||grp||':'||msg,0));
 select * into old from doogy_operations.preparation_commands where group_id=grp and message_id=msg;
 if found then
  if old.payload<>p then raise exception 'Source already recorded with different payload; reconcile with Leonardo.';end if;
  if old.kind='production' then perform private.verify_preparation(old.result);
  else
   perform private.verify_preparation_transfer(old.result);
  end if;
  return old.result;
 end if;
 if kind='production' then
  if data ? 'id' or data ? 'locationId' or data ? 'completedAt' or data ? 'status' then raise exception 'Production identity/location/date must be derived from source.';end if;
  result:=private.complete_preparation(data||jsonb_build_object('id',bid,'locationId',plaza,'completedAt',p->>'occurredAt','status','completed'),null);
  req:=bid;
 elsif kind='transfer' then
  if step is null or step not in ('create','approve','dispatch','receive') then raise exception 'Unsupported preparation transfer step.';end if;
  if jsonb_typeof(data->'lines') is distinct from 'array' then raise exception 'Transfer lines required.';end if;
  if jsonb_array_length(data->'lines') not between 1 and 200 then raise exception 'Between 1 and 200 transfer lines required.';end if;
  if exists(select 1 from jsonb_array_elements(data->'lines') x group by coalesce(x->>'inventory_item_id',x->>'request_line_id',x->>'transfer_line_id') having count(*)>1) then raise exception 'Duplicate transfer lines.';end if;
  if exists(select 1 from jsonb_array_elements(data->'lines') x where (x->>'quantity')::numeric is null or (x->>'quantity')::numeric<=0 or (x->>'quantity')::numeric>100000000) then raise exception 'Invalid transfer quantity.';end if;
  if step='create' then
   if (data->>'requesting_location_id')::uuid not in (plaza,mall) or (data->>'fulfilling_location_id')::uuid not in (plaza,mall) then raise exception 'Outside preparation stores.';end if;
   for ln in select value as x from jsonb_array_elements(data->'lines') loop
    if not exists(select 1 from public.recipes r join public.recipe_versions v on v.recipe_id=r.id and v.status='active' where r.organization_id=org and r.active and r.classification='prep_recipe' and (r.output_inventory_item_id=(ln.x->>'inventory_item_id')::uuid or exists(select 1 from public.recipe_components c where c.recipe_version_id=v.id and c.component_inventory_item_id=(ln.x->>'inventory_item_id')::uuid))) then raise exception 'Item outside Batch Prep scope.';end if;
   end loop;
  else
   req:=(data->>'request_id')::uuid;
   if not exists(select 1 from doogy_operations.preparation_commands c where c.entity_id=req and c.group_id=grp and c.kind='transfer' and c.payload->>'step'='create') then raise exception 'Transfer was not created in this preparation group.';end if;
  end if;
  result:=private.prep_internal_request_command(bid,step,data);
  req:=(result->>'request_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'sourceId',t.source_id,'sourceType',t.source_type,'type',t.transaction_type,'itemId',t.inventory_item_id,'locationId',t.location_id,'areaId',t.storage_area_id,'quantityBase',t.quantity_base) order by t.id),'[]') into moves from public.inventory_transactions t where
   (step='dispatch' and t.source_type='interstore_dispatch' and t.source_id in (select id from public.interstore_transfer_lines where transfer_id=(result->>'document_id')::uuid)) or
   (step='receive' and t.source_type='interstore_receipt' and t.source_id in (select id from public.interstore_receipt_lines where receipt_id=(result->>'document_id')::uuid));
  if step in ('dispatch','receive') and jsonb_array_length(moves)<>jsonb_array_length(data->'lines') then raise exception 'Transfer movement verification failed.';end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into lines from public.internal_request_lines l where l.request_id=req;
  result:=result||jsonb_build_object('movements',moves,'lines',lines,'saved',true);
  select result||jsonb_build_object('requestingLocationId',r.requesting_location_id,'fulfillingLocationId',r.fulfilling_location_id) into result from public.internal_requests r where r.id=req;
  perform private.verify_preparation_transfer(result);
 else raise exception 'Unsupported preparation operation.';end if;
 insert into doogy_operations.preparation_commands(group_id,message_id,payload,result,entity_id,kind) values(grp,msg,p,result,req,kind);
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,case when kind='production' then plaza else null end,null,'whatsapp.preparation.'||kind,'preparation_command',req,jsonb_build_object('groupId',grp,'messageId',msg,'sourceSha256',p->>'sourceSha256','payload',p,'result',result));
 return result;
end $$;
revoke all on function doogy_operations.record_whatsapp_preparation(jsonb) from public,anon,authenticated,service_role;
grant execute on function doogy_operations.record_whatsapp_preparation(jsonb) to doogy_prep_service;

-- Only the catalog needed to resolve the approved preparation workflow; no costs or sales.
create function doogy_operations.preparation_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 with versions as (
  select v.*,r.output_inventory_item_id,r.production_location_id,r.name as recipe_name from public.recipe_versions v join public.recipes r on r.id=v.recipe_id
  where r.organization_id='6013ed02-626a-497c-b951-619069035532' and r.active and r.classification='prep_recipe' and v.status='active'
 ), scoped_items as (
  select output_inventory_item_id as id from versions union select c.component_inventory_item_id from public.recipe_components c join versions v on v.id=c.recipe_version_id
 ) select jsonb_build_object(
 'recipes',coalesce((select jsonb_agg(jsonb_build_object('id',v.recipe_id,'versionId',v.id,'name',v.recipe_name,'itemId',v.output_inventory_item_id,'yieldQuantity',v.yield_quantity,'yieldItemUnitId',v.yield_item_unit_id,'productionLocationId',v.production_location_id,'components',(select coalesce(jsonb_agg(jsonb_build_object('itemId',c.component_inventory_item_id,'itemUnitId',c.component_item_unit_id,'quantity',c.quantity,'wastePercent',c.waste_percent,'locationId',c.location_id,'kind',c.component_type)),'[]') from public.recipe_components c where c.recipe_version_id=v.id))) from versions v),'[]'),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.internal_name,'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'unitId',u.unit_id,'factor',u.quantity_in_base_unit,'code',n.code,'name',n.name)),'[]') from public.inventory_item_units u join public.units n on n.id=u.unit_id where u.inventory_item_id=i.id),'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',l.location_id,'defaultAreaId',l.default_storage_area_id,'areas',(select coalesce(jsonb_agg(a.storage_area_id),'[]') from public.inventory_item_storage_areas a where a.inventory_item_id=i.id and a.location_id=l.location_id))),'[]') from public.location_inventory_items l where l.inventory_item_id=i.id and l.active and l.location_id in ('a74401ec-ce6e-4df4-ad5d-71ce11af4351','d61fa7fe-fbe7-41cd-b45c-6527fae9b6b6')))) from public.inventory_items i join scoped_items s on s.id=i.id where i.active),'[]'),
 'team',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',btrim(concat_ws(' ',t.first_name,t.last_name)),'locations',t.location_ids)) from public.hr_team_members t where t.organization_id='6013ed02-626a-497c-b951-619069035532' and t.status='active' and t.location_ids&&array['a74401ec-ce6e-4df4-ad5d-71ce11af4351','d61fa7fe-fbe7-41cd-b45c-6527fae9b6b6']::uuid[]),'[]'))
$$;
revoke all on function doogy_operations.preparation_catalog() from public,anon,authenticated,service_role;
grant execute on function doogy_operations.preparation_catalog() to doogy_prep_service;
