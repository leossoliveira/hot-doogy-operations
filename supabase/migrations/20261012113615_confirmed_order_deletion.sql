-- Permanently remove a single order after an explicit, version-checked confirmation.
create or replace function private.delete_order(p_order_id uuid,p_organization_id uuid,p_expected_updated_at timestamptz,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ord public.purchase_orders%rowtype;
begin
 if auth.uid() is null or not private.mfa_authorized() or p_confirmed is distinct from true then
  raise exception 'Order deletion denied.' using errcode='42501';
 end if;
 select * into ord from public.purchase_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not found or not private.is_org_member(ord.organization_id)
 or not private.has_org_role(ord.organization_id,array['owner','admin','manager']::public.member_role[])
 or not private.can_location(ord.location_id)
 or (ord.supplier_id is not null and not private.can_supplier(ord.supplier_id)) then
  raise exception 'Order deletion denied.' using errcode='42501';
 end if;
 if p_expected_updated_at is null or ord.updated_at is distinct from p_expected_updated_at then
  raise exception 'This order changed. Reload it before deleting.' using errcode='40001';
 end if;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(ord.organization_id,ord.location_id,auth.uid(),'order_deleted','purchase_orders',ord.id,
 to_jsonb(ord),
 jsonb_build_object('permanent',true));
 -- Unlink documents and completed operational records; preserve their quantities, costs and actors.
 update public.purchase_receipt_lines set purchase_order_line_id=null where purchase_order_line_id in (select id from public.purchase_order_lines where purchase_order_id=ord.id);
 update public.purchase_receipts set purchase_order_id=null where purchase_order_id=ord.id;
 update public.invoices set purchase_order_id=null where purchase_order_id=ord.id;
 delete from public.purchase_orders where id=ord.id;
 return jsonb_build_object('id',ord.id,'deleted',true);
end $$;
revoke all on function private.delete_order(uuid,uuid,timestamptz,boolean) from public,anon;
grant execute on function private.delete_order(uuid,uuid,timestamptz,boolean) to authenticated;
create or replace function public.delete_order(p_order_id uuid,p_organization_id uuid,p_expected_updated_at timestamptz,p_confirmed boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select private.delete_order(p_order_id,p_organization_id,p_expected_updated_at,p_confirmed);
$$;
revoke all on function public.delete_order(uuid,uuid,timestamptz,boolean) from public,anon;
grant execute on function public.delete_order(uuid,uuid,timestamptz,boolean) to authenticated;
notify pgrst,'reload schema';

;
