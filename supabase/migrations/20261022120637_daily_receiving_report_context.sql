-- Read-only operational projection for the two approved daily reports. The
-- existing receiving identity keeps no direct table access or financial data.
create function doogy_operations.receiving_daily_report(p_group text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare loc uuid; org constant uuid:='6013ed02-626a-497c-b951-619069035532';
begin
 loc:=case p_group when '120363428015218332@g.us' then 'a74401ec-ce6e-4df4-ad5d-71ce11af4351'::uuid
 when '120363411962198548@g.us' then 'd61fa7fe-fbe7-41cd-b45c-6527fae9b6b6'::uuid end;
 if loc is null then raise exception 'Unauthorized receiving group' using errcode='42501'; end if;
 return jsonb_build_object('groupId',p_group,'locationId',loc,'queriedAt',now(),
 'orders',(select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'reference',o.order_number,'supplier',s.name,'status',o.status,
  'expectedReceiveAt',o.expected_receive_at,
  'lines',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',l.id,'item',coalesce(nullif(i.internal_name,''),si.supplier_product_name),
   'orderedQuantity',l.ordered_purchase_qty,'unit',u.code,'unitFactor',iu.quantity_in_base_unit,
   'receivedBase',(select coalesce(sum(rl.quantity_base),0) from public.purchase_receipt_lines rl
     join public.purchase_receipts r on r.id=rl.receipt_id
     where rl.purchase_order_line_id=l.id and r.organization_id=org and r.location_id=loc and r.status::text='completed'),
   'issues',l.receipt_issues) order by l.id),'[]'::jsonb)
   from public.purchase_order_lines l
   left join public.inventory_items i on i.id=l.inventory_item_id and i.organization_id=org
   left join public.supplier_items si on si.id=l.supplier_item_id and si.organization_id=org
   left join public.inventory_item_units iu on iu.id=l.purchase_item_unit_id and iu.organization_id=org
   left join public.units u on u.id=iu.unit_id
   where l.purchase_order_id=o.id and l.organization_id=org)) order by o.id),'[]'::jsonb)
  from public.purchase_orders o left join public.suppliers s on s.id=o.supplier_id and s.organization_id=org
  where o.organization_id=org and o.location_id=loc and o.status::text in ('ordered','partially_received')),
 'receipts',(select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'orderId',r.purchase_order_id,'supplier',s.name,'status',r.status,
  'receivedAt',r.received_at,'documentReference',c.document_key,
  'sourceMessageId',c.message_id,'receiver',btrim(concat_ws(' ',tm.first_name,tm.last_name)),
  'lines',(select coalesce(jsonb_agg(jsonb_build_object('item',i.internal_name,'quantity',rl.quantity_received,'unit',u.code) order by rl.id),'[]'::jsonb)
   from public.purchase_receipt_lines rl left join public.inventory_items i on i.id=rl.inventory_item_id and i.organization_id=org
   left join public.inventory_item_units iu on iu.id=rl.received_item_unit_id and iu.organization_id=org
   left join public.units u on u.id=iu.unit_id where rl.receipt_id=r.id and rl.organization_id=org)) order by r.received_at,r.id),'[]'::jsonb)
  from public.purchase_receipts r left join public.suppliers s on s.id=r.supplier_id and s.organization_id=org
  left join public.hr_team_members tm on tm.id=r.receiver_team_member_id and tm.organization_id=org
  left join doogy_operations.receiving_commands c on c.receipt_id=r.id and c.group_id=p_group
  where r.organization_id=org and r.location_id=loc and r.status::text<>'cancelled'));
end $$;
revoke all on function doogy_operations.receiving_daily_report(text) from public,anon,authenticated,service_role;
grant execute on function doogy_operations.receiving_daily_report(text) to doogy_receiving_service;
