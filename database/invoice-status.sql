-- Manual status correction only: never posts receipts, changes stock/prices, or sends payments.
-- Existing invoice_s3_completion_guard remains enabled for approved/paid transitions.
create or replace function private.update_invoice_status(
  p_invoice_id uuid, p_organization_id uuid, p_status public.invoice_status,
  p_expected_status public.invoice_status, p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  invoice public.invoices%rowtype;
  saved public.invoices%rowtype;
begin
  if auth.uid() is null or not private.mfa_authorized() then
    raise exception 'Invoice status access denied.' using errcode='42501';
  end if;
  select * into invoice from public.invoices
    where id=p_invoice_id and organization_id=p_organization_id for update;
  if not found or not private.is_org_member(invoice.organization_id)
    or not private.has_org_role(invoice.organization_id,array['owner','admin','manager']::public.member_role[])
    or not private.can_location(invoice.location_id)
    or (invoice.supplier_id is not null and not private.can_supplier(invoice.supplier_id)) then
    raise exception 'Invoice status access denied.' using errcode='42501';
  end if;
  if p_status is null then raise exception 'Choose a valid invoice status.' using errcode='22023'; end if;
  if p_expected_status is null or p_expected_updated_at is null
    or invoice.status is distinct from p_expected_status
    or invoice.updated_at is distinct from p_expected_updated_at then
    raise exception 'This invoice changed. Reload its status before saving.' using errcode='40001';
  end if;
  if invoice.status=p_status then
    return jsonb_build_object('id',invoice.id,'status',invoice.status,'updatedAt',invoice.updated_at,'changed',false);
  end if;
  update public.invoices set status=p_status where id=invoice.id returning * into saved;
  insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(invoice.organization_id,invoice.location_id,auth.uid(),'invoice_status_changed','invoices',invoice.id,
      jsonb_build_object('status',invoice.status,'updated_at',invoice.updated_at),
      jsonb_build_object('status',saved.status,'updated_at',saved.updated_at,'source','manual_status_edit'));
  return jsonb_build_object('id',saved.id,'status',saved.status,'updatedAt',saved.updated_at,'changed',true);
end $$;
revoke all on function private.update_invoice_status(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz) from public, anon;
grant execute on function private.update_invoice_status(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz) to authenticated;

create or replace function public.update_invoice_status(
  p_invoice_id uuid, p_organization_id uuid, p_status public.invoice_status,
  p_expected_status public.invoice_status, p_expected_updated_at timestamptz
) returns jsonb language sql security invoker set search_path='' as $$
  select private.update_invoice_status(p_invoice_id,p_organization_id,p_status,p_expected_status,p_expected_updated_at);
$$;
revoke all on function public.update_invoice_status(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz) from public, anon;
grant execute on function public.update_invoice_status(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz) to authenticated;
