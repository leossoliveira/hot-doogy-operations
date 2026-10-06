-- Permanently remove a single invoice after an explicit, version-checked confirmation.
create or replace function private.delete_invoice(p_invoice_id uuid,p_organization_id uuid,p_expected_updated_at timestamptz,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invoice public.invoices%rowtype;
begin
 if auth.uid() is null or not private.mfa_authorized() or p_confirmed is distinct from true then
  raise exception 'Invoice deletion denied.' using errcode='42501';
 end if;
 select * into invoice from public.invoices where id=p_invoice_id and organization_id=p_organization_id for update;
 if not found or not private.is_org_member(invoice.organization_id)
 or not private.has_org_role(invoice.organization_id,array['owner','admin','manager']::public.member_role[])
 or not private.can_location(invoice.location_id)
 or (invoice.supplier_id is not null and not private.can_supplier(invoice.supplier_id)) then
  raise exception 'Invoice deletion denied.' using errcode='42501';
 end if;
 if p_expected_updated_at is null or invoice.updated_at is distinct from p_expected_updated_at then
  raise exception 'This invoice changed. Reload it before deleting.' using errcode='40001';
 end if;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(invoice.organization_id,invoice.location_id,auth.uid(),'invoice_deleted','invoices',invoice.id,
 jsonb_build_object('invoice_number',invoice.invoice_number,'status',invoice.status,'total',invoice.total),
 jsonb_build_object('permanent',true));
 delete from public.invoices where id=invoice.id;
 return jsonb_build_object('id',invoice.id,'deleted',true);
end $$;
revoke all on function private.delete_invoice(uuid,uuid,timestamptz,boolean) from public,anon;
grant execute on function private.delete_invoice(uuid,uuid,timestamptz,boolean) to authenticated;
create or replace function public.delete_invoice(p_invoice_id uuid,p_organization_id uuid,p_expected_updated_at timestamptz,p_confirmed boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select private.delete_invoice(p_invoice_id,p_organization_id,p_expected_updated_at,p_confirmed);
$$;
revoke all on function public.delete_invoice(uuid,uuid,timestamptz,boolean) from public,anon;
grant execute on function public.delete_invoice(uuid,uuid,timestamptz,boolean) to authenticated;
notify pgrst,'reload schema';
