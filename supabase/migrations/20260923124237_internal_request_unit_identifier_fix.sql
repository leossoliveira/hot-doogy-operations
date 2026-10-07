create or replace function private.internal_request_command(p_command_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $f$
declare
 req public.internal_requests%rowtype; ln public.internal_request_lines%rowtype;
 shipment public.interstore_transfers%rowtype; sl public.interstore_transfer_lines%rowtype;
 org uuid; requester uuid; fulfiller uuid; doc uuid; line_id uuid; area uuid;
 x jsonb; q numeric; factor numeric; sent numeric; received numeric; balance numeric;
 item uuid; selected_unit_id uuid; item_name text; out_json jsonb; canonical jsonb; old_cmd record;
begin
 if p_command_id is null or p_action is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
 then raise exception 'Command ID, action and object payload required'; end if;
 canonical:=jsonb_build_object('action',p_action,'payload',p_payload,'actor',auth.uid());
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 if p_action='create' then
  requester:=(p_payload->>'requesting_location_id')::uuid;
  fulfiller:=(p_payload->>'fulfilling_location_id')::uuid;
  select organization_id into org from public.locations where id=requester and active;
  if org is null or requester=fulfiller or not exists(select 1 from public.locations where id=fulfiller and organization_id=org and active)
  then raise exception 'Two active stores in the same organization required'; end if;
  perform private.internal_request_authorize(org,requester);
 else
  select * into req from public.internal_requests where id=(p_payload->>'request_id')::uuid for update;
  if not found then raise exception 'Request not found'; end if;
  org:=req.organization_id; requester:=req.requesting_location_id; fulfiller:=req.fulfilling_location_id;
  if p_action in ('approve','dispatch','reject','close_partial') then perform private.internal_request_authorize(org,fulfiller);
  elsif p_action in ('receive','cancel') then perform private.internal_request_authorize(org,requester);
  else raise exception 'Unsupported action'; end if;
 end if;
 select * into old_cmd from private.internal_request_commands where command_id=p_command_id;
 if found then
  if old_cmd.payload<>canonical then raise exception 'Command ID reused with different payload'; end if;
  return old_cmd.result;
 end if;
 if p_action in ('create','approve','dispatch','receive') then
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' then raise exception 'Lines array required'; end if;
  if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'Expected 1 to 200 lines'; end if;
 end if;
 if p_action='create' then
  insert into public.internal_requests(organization_id,requesting_location_id,fulfilling_location_id,needed_on,notes,created_by)
  values(org,requester,fulfiller,(p_payload->>'needed_on')::date,p_payload->>'notes',auth.uid()) returning * into req;
  for x in select value from jsonb_array_elements(p_payload->'lines') loop
   item:=(x->>'inventory_item_id')::uuid; selected_unit_id:=(x->>'item_unit_id')::uuid; q:=(x->>'quantity')::numeric;
   select quantity_in_base_unit into factor from public.inventory_item_units where id=selected_unit_id and inventory_item_id=item and organization_id=org;
   select coalesce(internal_name,name) into item_name from public.inventory_items where id=item and organization_id=org and active;
   if factor is null or item_name is null or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=requester and active)
    or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=fulfiller and active)
   then raise exception 'Item/unit must be active and enabled in both stores'; end if;
   insert into public.internal_request_lines(request_id,inventory_item_id,item_unit_id,unit_factor,requested_quantity,internal_name_snapshot)
   values(req.id,item,selected_unit_id,factor,q,item_name);
  end loop;
  doc:=req.id;
 elsif p_action='approve' then
  if req.status<>'submitted' then raise exception 'Only submitted requests can be approved'; end if;
  if (select count(*) from public.internal_request_lines where request_id=req.id)<>jsonb_array_length(p_payload->'lines')
   or (select count(distinct value->>'request_line_id') from jsonb_array_elements(p_payload->'lines'))<>jsonb_array_length(p_payload->'lines')
  then raise exception 'Approval must specify every request line exactly once'; end if;
  for x in select value from jsonb_array_elements(p_payload->'lines') loop
   q:=(x->>'quantity')::numeric;
   if q is null then raise exception 'Approved quantity required'; end if;
   update public.internal_request_lines set approved_quantity=q where id=(x->>'request_line_id')::uuid and request_id=req.id;
   if not found then raise exception 'Request line not found'; end if;
  end loop;
  if not exists(select 1 from public.internal_request_lines where request_id=req.id and approved_quantity>0) then raise exception 'Use reject for zero approval'; end if;
  update public.internal_requests set status='approved' where id=req.id;
  doc:=req.id;
 elsif p_action='dispatch' then
  if req.status not in ('approved','in_progress') then raise exception 'Request is not dispatchable'; end if;
  insert into public.interstore_transfers(request_id,dispatched_by,notes) values(req.id,auth.uid(),p_payload->>'notes') returning id into doc;
  -- Consistent item lock order serializes availability checks across this module.
  perform i.id from public.inventory_items i join public.internal_request_lines r on r.inventory_item_id=i.id where r.request_id=req.id order by i.id for update of i;
  for x in select value from jsonb_array_elements(p_payload->'lines') loop
   select * into ln from public.internal_request_lines where id=(x->>'request_line_id')::uuid and request_id=req.id;
   if not found then raise exception 'Request line not found'; end if;
   area:=(x->>'from_storage_area_id')::uuid; q:=(x->>'quantity')::numeric;
   if q is null or q<=0 or q>='Infinity'::numeric then raise exception 'Positive finite quantity required'; end if;
   if not exists(select 1 from public.storage_areas where id=area and location_id=fulfiller and organization_id=org and active)
    or not exists(select 1 from public.inventory_item_storage_areas where storage_area_id=area and inventory_item_id=ln.inventory_item_id)
   then raise exception 'Invalid origin storage area or item assignment'; end if;
   perform private.internal_request_authorize(org,fulfiller,area);
   select coalesce(sum(quantity),0) into sent from public.interstore_transfer_lines where request_line_id=ln.id;
   if sent+q>ln.approved_quantity then raise exception 'Dispatch exceeds approved quantity'; end if;
   select coalesce(sum(quantity_base),0) into balance from public.inventory_transactions where location_id=fulfiller and storage_area_id=area and inventory_item_id=ln.inventory_item_id;
   if balance<q*ln.unit_factor then raise exception 'Insufficient stock in origin storage area'; end if;
   insert into public.interstore_transfer_lines(transfer_id,request_line_id,from_storage_area_id,quantity)
   values(doc,ln.id,area,q) returning id into line_id;
   insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by)
   values(org,fulfiller,area,ln.inventory_item_id,'transfer_out',-q*ln.unit_factor,'interstore_dispatch',line_id,now(),auth.uid());
  end loop;
  update public.internal_requests set status='in_progress' where id=req.id;
 elsif p_action='receive' then
  if req.status<>'in_progress' then raise exception 'Request is not receivable'; end if;
  select * into shipment from public.interstore_transfers where id=(p_payload->>'transfer_id')::uuid and request_id=req.id;
  if not found then raise exception 'Transfer does not belong to request'; end if;
  insert into public.interstore_receipts(transfer_id,received_by,notes) values(shipment.id,auth.uid(),p_payload->>'notes') returning id into doc;
  for x in select value from jsonb_array_elements(p_payload->'lines') loop
   select * into sl from public.interstore_transfer_lines where id=(x->>'transfer_line_id')::uuid and transfer_id=shipment.id;
   if not found then raise exception 'Transfer line not found'; end if;
   select * into ln from public.internal_request_lines where id=sl.request_line_id;
   area:=(x->>'to_storage_area_id')::uuid; q:=(x->>'quantity')::numeric;
   if q is null or q<=0 or q>='Infinity'::numeric then raise exception 'Positive finite quantity required'; end if;
   if not exists(select 1 from public.storage_areas where id=area and location_id=requester and organization_id=org and active)
    or not exists(select 1 from public.inventory_item_storage_areas where storage_area_id=area and inventory_item_id=ln.inventory_item_id)
   then raise exception 'Invalid destination storage area or item assignment'; end if;
   perform private.internal_request_authorize(org,requester,area);
   select coalesce(sum(quantity),0) into received from public.interstore_receipt_lines where transfer_line_id=sl.id;
   if received+q>sl.quantity then raise exception 'Receipt exceeds dispatched quantity'; end if;
   insert into public.interstore_receipt_lines(receipt_id,transfer_line_id,to_storage_area_id,quantity)
   values(doc,sl.id,area,q) returning id into line_id;
   insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by)
   values(org,requester,area,ln.inventory_item_id,'transfer_in',q*ln.unit_factor,'interstore_receipt',line_id,now(),auth.uid());
  end loop;
  if not exists(
   select 1 from public.internal_request_lines r where r.request_id=req.id and r.approved_quantity>
    (select coalesce(sum(rl.quantity),0) from public.interstore_receipt_lines rl join public.interstore_transfer_lines tl on tl.id=rl.transfer_line_id where tl.request_line_id=r.id)
  ) then update public.internal_requests set status='completed' where id=req.id; end if;
 elsif p_action in ('cancel','reject') then
  if req.status not in ('submitted','approved') then raise exception 'Cannot cancel a dispatched request'; end if;
  if nullif(btrim(p_payload->>'notes'),'') is null then raise exception 'Reason required'; end if;
  update public.internal_requests set status='cancelled' where id=req.id;
  doc:=req.id;
 elsif p_action='close_partial' then
  if req.status not in ('approved','in_progress') or nullif(btrim(p_payload->>'notes'),'') is null then raise exception 'Open request and reason required'; end if;
  if exists(select 1 from public.interstore_transfer_lines t join public.interstore_transfers d on d.id=t.transfer_id where d.request_id=req.id
   and t.quantity>(select coalesce(sum(r.quantity),0) from public.interstore_receipt_lines r where r.transfer_line_id=t.id))
  then raise exception 'Cannot close while stock remains in transit'; end if;
  update public.internal_requests set status='closed_partial' where id=req.id;
  doc:=req.id;
 end if;
 select jsonb_build_object('request_id',r.id,'document_id',doc,'status',r.status,'action',p_action) into out_json from public.internal_requests r where r.id=req.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 values(org,case when p_action in ('create','receive','cancel') then requester else fulfiller end,auth.uid(),'internal_request.'||p_action,'internal_request',req.id,canonical||out_json);
 insert into private.internal_request_commands(command_id,payload,result) values(p_command_id,canonical,out_json);
 return out_json;
end $f$;

;
