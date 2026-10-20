-- Keep receiving issues with their order line. Issues never post stock or close a line.
alter table public.purchase_order_lines add column receipt_issues jsonb not null default '[]'::jsonb check (jsonb_typeof(receipt_issues)='array');

do $migration$
declare definition text; anchor text; replacement text;
begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 anchor:=$old$if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 200 then raise exception 'Informe as quantidades recebidas.';end if;$old$;
 replacement:=$new$if old_order.status not in ('ordered','partially_received') then raise exception 'Order is not awaiting receipt.';end if;
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines')>200
    or jsonb_typeof(coalesce(p->'issues','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p->'issues','[]'::jsonb))>200
    or jsonb_array_length(p->'lines')+jsonb_array_length(coalesce(p->'issues','[]'::jsonb))=0 then raise exception 'Select items to receive or report.';end if;
  if jsonb_array_length(p->'lines')>0 and not exists(select 1 from public.hr_team_members t where t.id=(p->>'receiverTeamMemberId')::uuid and t.organization_id=org and t.status='active' and old_order.location_id=any(t.location_ids)) then raise exception 'Choose an active receiver assigned to this location.';end if;$new$;
 if position(anchor in definition)=0 then raise exception 'Unexpected receipt validation';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$old$insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by,receiver_team_member_id) values(id,org,old_order.location_id,old_order.supplier_id,old_order.id,(p->>'receivedAt')::timestamptz,actor,nullif(p->>'receiverTeamMemberId','')::uuid);$old$;
 replacement:=$new$if (select count(*) from jsonb_array_elements(coalesce(p->'issues','[]'::jsonb)))<>(select count(distinct value->>'lineId') from jsonb_array_elements(coalesce(p->'issues','[]'::jsonb))) then raise exception 'Duplicate issue line.';end if;
  for x in select value from jsonb_array_elements(coalesce(p->'issues','[]'::jsonb)) loop
   select * into ol from public.purchase_order_lines where purchase_order_lines.id=(x->>'lineId')::uuid and purchase_order_id=old_order.id and organization_id=org for update;
   if not found then raise exception 'Issue line does not belong to this order.';end if;
   quantity:=(x->>'quantity')::numeric;
   if quantity is null or quantity<=0 or quantity>100000000 or nullif(btrim(x->>'reason'),'') is null or length(x->>'reason')>1000 then raise exception 'Enter a valid issue quantity and reason.';end if;
   if quantity+(select coalesce(sum(prl.quantity_received),0) from public.purchase_receipt_lines prl join public.purchase_receipts pr on pr.id=prl.receipt_id where prl.purchase_order_line_id=ol.id and pr.status='completed' and prl.received_item_unit_id=ol.purchase_item_unit_id)
      +(select coalesce(sum((j->>'quantity')::numeric),0) from jsonb_array_elements(p->'lines') j where j->>'lineId'=ol.id::text)>ol.ordered_purchase_qty then raise exception 'Issue exceeds the pending quantity. Reopen the order.';end if;
   update public.purchase_order_lines set receipt_issues=receipt_issues||jsonb_build_array(jsonb_build_object('id',id,'quantity',quantity,'reason',btrim(x->>'reason'),'reportedAt',p->>'receivedAt','reportedBy',actor,'receiverTeamMemberId',p->>'receiverTeamMemberId')) where purchase_order_lines.id=ol.id;
  end loop;
  if jsonb_array_length(coalesce(p->'issues','[]'::jsonb))>0 then
   insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,old_order.location_id,actor,'receipt_issues','purchase_order',old_order.id,jsonb_build_object('issues',p->'issues','receiverTeamMemberId',p->>'receiverTeamMemberId'));
  end if;
  if jsonb_array_length(p->'lines')=0 then return jsonb_build_object('id',old_order.id,'issuesRecorded',true);end if;
  insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by,receiver_team_member_id) values(id,org,old_order.location_id,old_order.supplier_id,old_order.id,(p->>'receivedAt')::timestamptz,actor,nullif(p->>'receiverTeamMemberId','')::uuid);$new$;
 if position(anchor in definition)=0 then raise exception 'Unexpected receipt insert';end if;
 execute replace(definition,anchor,replacement);
end $migration$;
notify pgrst,'reload schema';
