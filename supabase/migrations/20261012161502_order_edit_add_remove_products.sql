-- Edit a draft atomically without replacing line identities or changing linked documents.
create or replace function private.edit_order_details(p_order uuid,p_organization uuid,p_expected_updated_at timestamptz,p_number text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ord public.purchase_orders; x jsonb; qty numeric; price numeric; before_lines jsonb; selected public.supplier_items;
begin
 select * into ord from public.purchase_orders where id=p_order and organization_id=p_organization for update;
 if ord.id is null or auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(ord.organization_id,array['owner','admin','manager']::public.member_role[]) or not private.can_location(ord.location_id) or not private.can_supplier(ord.supplier_id) then raise exception 'Order access denied' using errcode='42501';end if;
 if p_expected_updated_at is null or ord.updated_at is distinct from p_expected_updated_at then raise exception 'Order changed. Reload before saving.' using errcode='40001';end if;
 if ord.status<>'draft' or exists(select 1 from public.purchase_receipts where purchase_order_id=ord.id) then raise exception 'Only drafts without receipts can be edited';end if;
 if nullif(btrim(p_number),'') is null or length(btrim(p_number))>100 then raise exception 'Enter an order identifier up to 100 characters';end if;
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Invalid order lines';end if;
 if jsonb_array_length(p_lines)>200 or (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Order lines changed. Reload before saving.';end if;
 select jsonb_agg(to_jsonb(l) order by l.id) into before_lines from public.purchase_order_lines l where purchase_order_id=ord.id;
 for x in select value from jsonb_array_elements(p_lines) loop
  qty:=(x->>'quantity')::numeric;price:=(x->>'price')::numeric;
  if qty is null or qty<=0 or qty>100000000 or qty::text in ('NaN','Infinity','-Infinity') or price<0 or price>100000000 or price::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid quantity or price';end if;
  update public.purchase_order_lines set ordered_purchase_qty=qty,estimated_unit_price=price,line_total=qty*price where id=(x->>'id')::uuid and purchase_order_id=ord.id and organization_id=ord.organization_id;
  if not found then
   select * into selected from public.supplier_items where id=(x->>'supplierItemId')::uuid and organization_id=ord.organization_id and supplier_id=ord.supplier_id and active for share;
   if selected.id is null or not exists(select 1 from public.inventory_items where id=selected.inventory_item_id and organization_id=ord.organization_id and active) or not exists(select 1 from public.location_inventory_items where inventory_item_id=selected.inventory_item_id and location_id=ord.location_id and active) or not exists(select 1 from public.inventory_item_units where id=selected.purchase_item_unit_id and inventory_item_id=selected.inventory_item_id and organization_id=ord.organization_id) then raise exception 'Select an active product for this supplier and location';end if;
   insert into public.purchase_order_lines(id,organization_id,purchase_order_id,supplier_item_id,inventory_item_id,purchase_item_unit_id,ordered_purchase_qty,estimated_unit_price,line_total) values((x->>'id')::uuid,ord.organization_id,ord.id,selected.id,selected.inventory_item_id,selected.purchase_item_unit_id,qty,price,qty*price);
  end if;
 end loop;
 delete from public.purchase_order_lines where purchase_order_id=ord.id and id not in (select (value->>'id')::uuid from jsonb_array_elements(p_lines));
 update public.purchase_orders set order_number=btrim(p_number),updated_at=clock_timestamp(),estimated_total=(select case when count(*)=0 or count(estimated_unit_price)<>count(*) then null else sum(line_total) end from public.purchase_order_lines where purchase_order_id=ord.id) where id=ord.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data) values(ord.organization_id,ord.location_id,auth.uid(),'order_edited','purchase_orders',ord.id,jsonb_build_object('number',ord.order_number,'lines',before_lines),jsonb_build_object('number',btrim(p_number),'lines',p_lines));
 return jsonb_build_object('id',ord.id,'saved',true);
end $$;
notify pgrst,'reload schema';
