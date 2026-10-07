
create table public.internal_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 requesting_location_id uuid not null references public.locations(id),
 fulfilling_location_id uuid not null references public.locations(id),
 needed_on date not null,
 status text not null default 'submitted' check(status in ('submitted','approved','in_progress','completed','cancelled','closed_partial')),
 notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 check(requesting_location_id<>fulfilling_location_id)
);
create table public.internal_request_lines (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.internal_requests(id),
 inventory_item_id uuid not null references public.inventory_items(id),
 item_unit_id uuid not null references public.inventory_item_units(id),
 unit_factor numeric not null check(unit_factor>0 and unit_factor<'Infinity'::numeric),
 requested_quantity numeric not null check(requested_quantity>0 and requested_quantity<'Infinity'::numeric),
 approved_quantity numeric check(approved_quantity>=0 and approved_quantity<=requested_quantity),
 internal_name_snapshot text not null,
 unique(request_id,inventory_item_id)
);
create table public.interstore_transfers (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.internal_requests(id),
 dispatched_by uuid references auth.users(id), dispatched_at timestamptz not null default now(), notes text
);
create table public.interstore_transfer_lines (
 id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.interstore_transfers(id),
 request_line_id uuid not null references public.internal_request_lines(id),
 from_storage_area_id uuid not null references public.storage_areas(id),
 quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
 unique(transfer_id,request_line_id)
);
create table public.interstore_receipts (
 id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.interstore_transfers(id),
 received_by uuid references auth.users(id), received_at timestamptz not null default now(), notes text
);
create table public.interstore_receipt_lines (
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.interstore_receipts(id),
 transfer_line_id uuid not null references public.interstore_transfer_lines(id),
 to_storage_area_id uuid not null references public.storage_areas(id),
 quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
 unique(receipt_id,transfer_line_id)
);
create table private.internal_request_commands (
 command_id uuid primary key, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table private.internal_request_commands enable row level security;
revoke all on private.internal_request_commands from public,anon,authenticated;

create index internal_requests_requesting_idx on public.internal_requests(requesting_location_id,status,needed_on);
create index internal_requests_fulfilling_idx on public.internal_requests(fulfilling_location_id,status,needed_on);
create index interstore_transfers_request_idx on public.interstore_transfers(request_id);
create index interstore_lines_request_line_idx on public.interstore_transfer_lines(request_line_id);
create index interstore_receipts_transfer_idx on public.interstore_receipts(transfer_id);
create index interstore_receipt_transfer_line_idx on public.interstore_receipt_lines(transfer_line_id);

create function private.internal_request_authorize(p_org uuid,p_location uuid,p_storage uuid default null) returns void
language plpgsql security definer set search_path='' as $f$
begin
 if coalesce(auth.jwt()->>'role','')='service_role' or
 (session_user in ('postgres','supabase_admin') and current_setting('role') in ('none','postgres')) then return; end if;
 if auth.uid() is null or not coalesce(private.is_org_member(p_org)
 and private.can_location(p_location)
 and private.has_org_role(p_org,array['owner','admin','manager','chef']::public.member_role[])
 and (p_storage is null or private.can_storage(p_storage)),false) then
 raise exception 'Not authorized for this store or storage area' using errcode='42501';
 end if;
end $f$;

create function private.internal_request_command(p_command_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $f$
declare
 req public.internal_requests%rowtype; ln public.internal_request_lines%rowtype;
 shipment public.interstore_transfers%rowtype; sl public.interstore_transfer_lines%rowtype;
 org uuid; requester uuid; fulfiller uuid; doc uuid; line_id uuid; area uuid;
 x jsonb; q numeric; factor numeric; sent numeric; received numeric; balance numeric;
 item uuid; unit_id uuid; item_name text; out_json jsonb; canonical jsonb; old_cmd record;
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
   item:=(x->>'inventory_item_id')::uuid; unit_id:=(x->>'item_unit_id')::uuid; q:=(x->>'quantity')::numeric;
   select quantity_in_base_unit into factor from public.inventory_item_units where id=unit_id and inventory_item_id=item and organization_id=org;
   select coalesce(internal_name,name) into item_name from public.inventory_items where id=item and organization_id=org and active;
   if factor is null or item_name is null or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=requester and active)
    or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=fulfiller and active)
   then raise exception 'Item/unit must be active and enabled in both stores'; end if;
   insert into public.internal_request_lines(request_id,inventory_item_id,item_unit_id,unit_factor,requested_quantity,internal_name_snapshot)
   values(req.id,item,unit_id,factor,q,item_name);
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
revoke all on function private.internal_request_authorize(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.internal_request_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.internal_request_command(uuid,text,jsonb) to authenticated,service_role;
create function public.internal_request_command(p_command_id uuid,p_action text,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $f$ select private.internal_request_command(p_command_id,p_action,p_payload); $f$;
revoke all on function public.internal_request_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.internal_request_command(uuid,text,jsonb) to authenticated,service_role;

alter table public.internal_requests enable row level security;
create policy internal_requests_read on public.internal_requests for select to authenticated using(
 private.is_org_member(organization_id) and (private.can_location(requesting_location_id) or private.can_location(fulfilling_location_id))
);
do $d$
declare t text;
begin
 foreach t in array array['internal_requests','internal_request_lines','interstore_transfers','interstore_transfer_lines','interstore_receipts','interstore_receipt_lines'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated,service_role',t);
 end loop;
end $d$;
create policy request_lines_read on public.internal_request_lines for select to authenticated using(exists(select 1 from public.internal_requests r where r.id=request_id));
create policy transfers_read on public.interstore_transfers for select to authenticated using(exists(select 1 from public.internal_requests r where r.id=request_id));
create policy transfer_lines_read on public.interstore_transfer_lines for select to authenticated using(exists(select 1 from public.interstore_transfers t where t.id=transfer_id));
create policy receipts_read on public.interstore_receipts for select to authenticated using(exists(select 1 from public.interstore_transfers t where t.id=transfer_id));
create policy receipt_lines_read on public.interstore_receipt_lines for select to authenticated using(exists(select 1 from public.interstore_receipts r where r.id=receipt_id));

create view public.v_internal_request_progress with(security_invoker=true) as
select r.id request_id,r.organization_id,r.requesting_location_id,r.fulfilling_location_id,r.needed_on,r.status,
 l.id request_line_id,l.inventory_item_id,l.internal_name_snapshot,l.item_unit_id,l.unit_factor,l.requested_quantity,l.approved_quantity,
 coalesce(s.quantity,0) dispatched_quantity,coalesce(a.quantity,0) received_quantity,
 coalesce(s.quantity,0)-coalesce(a.quantity,0) in_transit_quantity,
 l.approved_quantity-coalesce(s.quantity,0) remaining_to_dispatch
from public.internal_requests r join public.internal_request_lines l on l.request_id=r.id
left join lateral(select sum(quantity) quantity from public.interstore_transfer_lines where request_line_id=l.id) s on true
left join lateral(select sum(rl.quantity) quantity from public.interstore_receipt_lines rl join public.interstore_transfer_lines tl on tl.id=rl.transfer_line_id where tl.request_line_id=l.id) a on true;
revoke all on public.v_internal_request_progress from public,anon;
grant select on public.v_internal_request_progress to authenticated,service_role;

;
