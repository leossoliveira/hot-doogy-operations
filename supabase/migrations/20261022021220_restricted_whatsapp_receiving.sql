-- Machine receiving only: no invoice approval, payment, price or general table access.
create role doogy_receiving_service nologin noinherit;
grant usage on schema doogy_operations to doogy_receiving_service,doogy_waste_service;
create table doogy_operations.receiving_commands (
 group_id text not null,message_id text not null,payload jsonb not null,result jsonb not null,
 receipt_id uuid not null unique references public.purchase_receipts(id),location_id uuid not null,
 supplier_id uuid not null,document_key text not null,created_at timestamptz not null default now(),
 primary key(group_id,message_id),unique(location_id,supplier_id,document_key)
);
alter table doogy_operations.receiving_commands enable row level security;
revoke all on doogy_operations.receiving_commands from public,anon,authenticated,service_role,doogy_receiving_service;
-- Reuse the installed stock posting, storage checks and order state transition.
-- Human authentication remains unchanged; only the guarded machine wrapper calls this copy.
do $migration$
declare definition text;start_at int;end_at int;
begin
 definition:=pg_get_functiondef('public.confirm_purchase_receipt(uuid)'::regprocedure);
 definition:=replace(definition,'FUNCTION public.confirm_purchase_receipt(','FUNCTION private.confirm_whatsapp_receipt(');
 start_at:=position(' if not private.mfa_authorized()' in definition);
 end_at:=position('  select * into v_receipt' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'Unexpected receipt authentication implementation';end if;
 definition:=substring(definition from 1 for start_at-1)||substring(definition from end_at);
 start_at:=position('  if not private.is_org_member(v_receipt.organization_id)' in definition);
 end_at:=position('  if v_receipt.status' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'Unexpected receipt authorization implementation';end if;
 definition:=substring(definition from 1 for start_at-1)||substring(definition from end_at);
 definition:=replace(definition,'(select auth.uid())','null::uuid');
 execute definition;
end $migration$;
revoke all on function private.confirm_whatsapp_receipt(uuid) from public,anon,authenticated,service_role,doogy_receiving_service;

create function private.verify_whatsapp_receipt(r jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare m jsonb;b public.purchase_receipts%rowtype;
begin
 select * into b from public.purchase_receipts where id=(r->>'id')::uuid;
 if not found or b.status::text<>'completed' or b.location_id is distinct from (r->>'locationId')::uuid
 or b.supplier_id is distinct from (r->>'supplierId')::uuid or b.purchase_order_id is distinct from nullif(r->>'orderId','')::uuid
 or b.receiver_team_member_id is distinct from (r->>'receiverTeamMemberId')::uuid or b.received_at is distinct from (r->>'receivedAt')::timestamptz
 then raise exception 'Receipt no longer matches; reconcile before retry';end if;
 if (select count(*) from public.purchase_receipt_lines where receipt_id=b.id)<>jsonb_array_length(r->'movements')
 or (select count(*) from public.inventory_transactions where source_type='purchase_receipt_line' and source_id in(select id from public.purchase_receipt_lines where receipt_id=b.id))<>jsonb_array_length(r->'movements') then raise exception 'Receipt evidence count changed';end if;
 for m in select value from jsonb_array_elements(r->'movements') loop
  if not exists(select 1 from public.purchase_receipt_lines l join public.inventory_transactions t on t.source_id=l.id and t.source_type='purchase_receipt_line'
   where l.receipt_id=b.id and l.id=(m->>'lineId')::uuid and t.id=(m->>'id')::uuid
   and l.inventory_item_id=(m->>'itemId')::uuid and l.storage_area_id=(m->>'areaId')::uuid and l.quantity_base=(m->>'quantityBase')::numeric
   and l.received_item_unit_id=(m->>'itemUnitId')::uuid and l.quantity_received=(m->>'quantity')::numeric
   and t.inventory_item_id=l.inventory_item_id and t.storage_area_id=l.storage_area_id and t.location_id=b.location_id
   and t.quantity_base=l.quantity_base and t.transaction_type::text='purchase_receipt') then raise exception 'Receipt movement changed; reconcile before retry';end if;
 end loop;
end $$;
revoke all on function private.verify_whatsapp_receipt(jsonb) from public,anon,authenticated,service_role,doogy_receiving_service;

create function doogy_operations.record_whatsapp_receiving(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org constant uuid:='6013ed02-626a-497c-b951-619069035532';grp text:=p->>'groupId';msg text:=p->>'messageId';
 loc uuid;sid uuid:=(p->>'supplierId')::uuid;oid uuid:=nullif(p->>'orderId','')::uuid;rid uuid:=gen_random_uuid();
 tm uuid:=(p->>'receiverTeamMemberId')::uuid;stamp timestamptz:=(p->>'occurredAt')::timestamptz;doc text:=btrim(p->>'documentKey');
 old doogy_operations.receiving_commands%rowtype;o public.purchase_orders%rowtype;ol public.purchase_order_lines%rowtype;
 u public.inventory_item_units%rowtype;x jsonb;qty numeric;base numeric;item uuid;area uuid;si uuid;lineid uuid;
 moves jsonb;result jsonb;signature jsonb;
begin
 loc:=case grp when '120363428015218332@g.us' then 'a74401ec-ce6e-4df4-ad5d-71ce11af4351'::uuid when '120363411962198548@g.us' then 'd61fa7fe-fbe7-41cd-b45c-6527fae9b6b6'::uuid end;
 if loc is null or p->>'agentId' is distinct from 'doogy-purchasing-receiving' then raise exception 'Unauthorized receiving agent/group' using errcode='42501';end if;
 if msg is null or msg !~ '^[A-Za-z0-9_-]{8,128}$' or coalesce(p->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
 or coalesce(p->>'documentSha256','') !~ '^[a-f0-9]{64}$' or nullif(doc,'') is null or length(doc)>300 then raise exception 'Verified source and original document required';end if;
 if stamp is null or not isfinite(stamp) or stamp>now() or stamp<date '2000-01-01' then raise exception 'Invalid source date';end if;
 if not exists(select 1 from public.suppliers where id=sid and organization_id=org and active)
 or not exists(select 1 from public.hr_team_members where id=tm and organization_id=org and status='active' and loc=any(location_ids)) then raise exception 'Active supplier and receiver assigned to store required';end if;
 perform pg_advisory_xact_lock(hashtextextended('receiving-source:'||grp||':'||msg,0));
 perform pg_advisory_xact_lock(hashtextextended('receiving-document:'||loc||':'||sid||':'||doc,0));
 select * into old from doogy_operations.receiving_commands where group_id=grp and message_id=msg;
 if found then
  if old.payload<>p then raise exception 'Source already recorded with different payload';end if;
  perform private.verify_whatsapp_receipt(old.result);return old.result;
 end if;
 if exists(select 1 from doogy_operations.receiving_commands where location_id=loc and supplier_id=sid and (document_key=doc or payload->>'documentSha256'=p->>'documentSha256')) then raise exception 'Document already received under another source message';end if;
 if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 200 then raise exception 'Receipt lines required';end if;
 if (select count(*) from jsonb_array_elements(p->'lines'))<>(select count(distinct value->>'itemId') from jsonb_array_elements(p->'lines')) then raise exception 'Duplicate receipt item; consolidate verified quantities';end if;
 if oid is not null then
  select * into o from public.purchase_orders where id=oid for update;
  if not found or o.organization_id<>org or o.location_id<>loc or o.supplier_id<>sid or o.status::text not in ('ordered','partially_received') then raise exception 'Order not awaiting receipt in source store/supplier';end if;
 elsif sid not in ('2968afb1-68e8-4c7b-8a22-d0254821b6be'::uuid,'dcd4afb9-c628-4760-a490-23db4653fa7d'::uuid) and
  (coalesce(p->>'authorizationMessageId','') !~ '^[A-Za-z0-9_-]{8,128}$' or coalesce(p->>'authorizationSha256','') !~ '^[a-f0-9]{64}$') then raise exception 'Leonardo authorization required without purchase order';end if;
 -- Flag matching legacy receipts, including ones created outside this adapter.
 select jsonb_agg(jsonb_build_array(z.item,z.base) order by z.item) into signature from
 (select (j->>'itemId')::uuid item,sum((j->>'quantity')::numeric*iu.quantity_in_base_unit) base from jsonb_array_elements(p->'lines') j join public.inventory_item_units iu on iu.id=(j->>'itemUnitId')::uuid group by 1) z;
 if exists(select 1 from public.purchase_receipts pr where pr.organization_id=org and pr.location_id=loc and pr.supplier_id=sid and pr.status::text<>'cancelled'
 and (pr.received_at at time zone 'America/New_York')::date=(stamp at time zone 'America/New_York')::date
 and (select jsonb_agg(jsonb_build_array(z.item,z.base) order by z.item) from(select inventory_item_id item,sum(quantity_base) base from public.purchase_receipt_lines where receipt_id=pr.id group by 1)z)=signature) then raise exception 'Possible legacy duplicate receipt; reconcile before posting';end if;
 insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by,receiver_team_member_id,notes)
 values(rid,org,loc,sid,oid,stamp,null,tm,'WhatsApp document: '||doc||coalesce(E'\n'||nullif(p->>'notes',''),''));
 for x in select value from jsonb_array_elements(p->'lines') loop
  item:=(x->>'itemId')::uuid;area:=(x->>'areaId')::uuid;si:=nullif(x->>'supplierItemId','')::uuid;qty:=(x->>'quantity')::numeric;
  select * into u from public.inventory_item_units where id=(x->>'itemUnitId')::uuid and inventory_item_id=item and organization_id=org;
  if not found or qty is null or qty<=0 or qty>100000000 or qty::text in ('NaN','Infinity','-Infinity') or u.quantity_in_base_unit<=0 then raise exception 'Invalid item quantity or unit';end if;
  base:=qty*u.quantity_in_base_unit;
  if base<=0 or base>1000000000 or round(base,6)<>base or not exists(select 1 from public.inventory_items where id=item and organization_id=org and active) then raise exception 'Inactive item or invalid precision';end if;
  if si is not null and not exists(select 1 from public.supplier_items where id=si and supplier_id=sid and inventory_item_id=item and organization_id=org and active) then raise exception 'Supplier item does not match';end if;
  ol:=null;
  if oid is not null then
   select * into ol from public.purchase_order_lines where id=(x->>'orderLineId')::uuid and purchase_order_id=oid and organization_id=org and inventory_item_id=item for update;
   if not found or (si is not null and si is distinct from ol.supplier_item_id) then raise exception 'Receipt line does not belong to order';end if;
   if base+(select coalesce(sum(l.quantity_base),0) from public.purchase_receipt_lines l join public.purchase_receipts r on r.id=l.receipt_id where l.purchase_order_line_id=ol.id and r.status::text='completed')>
    ol.ordered_purchase_qty*(select quantity_in_base_unit from public.inventory_item_units where id=ol.purchase_item_unit_id) then raise exception 'Receipt exceeds pending order quantity';end if;
   si:=ol.supplier_item_id;
  elsif x ? 'orderLineId' then raise exception 'Order line supplied without order';end if;
  insert into public.purchase_receipt_lines(organization_id,receipt_id,purchase_order_line_id,supplier_item_id,inventory_item_id,storage_area_id,received_item_unit_id,quantity_received,quantity_base)
  values(org,rid,ol.id,si,item,area,u.id,qty,base);
 end loop;
 perform private.confirm_whatsapp_receipt(rid);
 select jsonb_agg(jsonb_build_object('id',t.id,'lineId',l.id,'itemId',l.inventory_item_id,'areaId',l.storage_area_id,'quantityBase',l.quantity_base,'quantity',l.quantity_received,'itemUnitId',l.received_item_unit_id) order by l.id) into moves
 from public.purchase_receipt_lines l join public.inventory_transactions t on t.source_id=l.id and t.source_type='purchase_receipt_line' where l.receipt_id=rid;
 result:=jsonb_build_object('id',rid,'locationId',loc,'supplierId',sid,'orderId',oid,'receiverTeamMemberId',tm,'receivedAt',stamp,'documentKey',doc,'movements',moves,'saved',true);
 if jsonb_array_length(moves)<>jsonb_array_length(p->'lines') then raise exception 'Incomplete receipt stock posting';end if;
 perform private.verify_whatsapp_receipt(result);
 insert into doogy_operations.receiving_commands values(grp,msg,p,result,rid,loc,sid,doc,now());
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,loc,null,'whatsapp.receiving','purchase_receipt',rid,jsonb_build_object('payload',p,'result',result));
 return result;
end $$;
revoke all on function doogy_operations.record_whatsapp_receiving(jsonb) from public,anon,authenticated,service_role;
grant execute on function doogy_operations.record_whatsapp_receiving(jsonb) to doogy_receiving_service;

create function doogy_operations.receiving_catalog(p_group text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare loc uuid;org constant uuid:='6013ed02-626a-497c-b951-619069035532';result jsonb;
begin
 loc:=case p_group when '120363428015218332@g.us' then 'a74401ec-ce6e-4df4-ad5d-71ce11af4351'::uuid when '120363411962198548@g.us' then 'd61fa7fe-fbe7-41cd-b45c-6527fae9b6b6'::uuid end;
 if loc is null then raise exception 'Unauthorized receiving group';end if;
 select jsonb_build_object('locationId',loc,
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.suppliers where organization_id=org and active),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.internal_name,'units',(select jsonb_agg(jsonb_build_object('id',u.id,'code',s.code,'factor',u.quantity_in_base_unit)) from public.inventory_item_units u join public.units s on s.id=u.unit_id where u.inventory_item_id=i.id),'areas',(select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name)) from public.inventory_item_storage_areas x join public.storage_areas a on a.id=x.storage_area_id where x.inventory_item_id=i.id and x.location_id=loc and a.active))),'[]') from public.inventory_items i join public.location_inventory_items l on l.inventory_item_id=i.id and l.location_id=loc where i.organization_id=org and i.active and l.active),
 'team',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',btrim(concat_ws(' ',first_name,last_name)))),'[]') from public.hr_team_members where organization_id=org and status='active' and loc=any(location_ids)),
 'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'supplierId',o.supplier_id,'status',o.status,'lines',(select jsonb_agg(jsonb_build_object('id',l.id,'itemId',l.inventory_item_id,'supplierItemId',l.supplier_item_id,'itemUnitId',l.purchase_item_unit_id,'orderedQuantity',l.ordered_purchase_qty,'receivedBase',(select coalesce(sum(r.quantity_base),0) from public.purchase_receipt_lines r join public.purchase_receipts pr on pr.id=r.receipt_id where r.purchase_order_line_id=l.id and pr.status::text='completed'),'issues',l.receipt_issues)) from public.purchase_order_lines l where l.purchase_order_id=o.id))),'[]') from public.purchase_orders o where o.organization_id=org and o.location_id=loc and o.status::text in ('ordered','partially_received'))) into result;
 return result;
end $$;
revoke all on function doogy_operations.receiving_catalog(text) from public,anon,authenticated,service_role;
grant execute on function doogy_operations.receiving_catalog(text) to doogy_receiving_service;

-- Waste receives only its store's inventory and team, never receiving orders/suppliers.
create function doogy_operations.waste_catalog(p_group text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receiving_group text;r jsonb;
begin
 receiving_group:=case p_group when '120363311370740378@g.us' then '120363428015218332@g.us' when '120363402354455463@g.us' then '120363411962198548@g.us' end;
 if receiving_group is null then raise exception 'Unauthorized waste group';end if;
 r:=doogy_operations.receiving_catalog(receiving_group);
 return jsonb_build_object('locationId',r->'locationId','items',r->'items','team',r->'team');
end $$;
revoke all on function doogy_operations.waste_catalog(text) from public,anon,authenticated,service_role;
grant execute on function doogy_operations.waste_catalog(text) to doogy_waste_service;
