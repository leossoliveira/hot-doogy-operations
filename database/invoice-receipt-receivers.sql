-- Expose only receiver display names for receipts the signed-in finance user can access.
create or replace function private.invoice_receipt_receivers(p_organization_id uuid,p_receipt_ids uuid[])
returns table(receipt_id uuid,received_by_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.mfa_authorized()
  or not private.has_org_role(p_organization_id,array['owner','admin','manager']::public.member_role[]) then
  raise exception 'Receipt access denied.' using errcode='42501';
 end if;
 return query select r.id,coalesce(nullif(btrim(p.full_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),u.email)::text
 from public.purchase_receipts r
 join auth.users u on u.id=r.received_by
 left join public.profiles p on p.id=u.id
 where r.organization_id=p_organization_id and r.id=any(p_receipt_ids)
  and private.is_org_member(r.organization_id) and private.can_location(r.location_id) and private.can_supplier(r.supplier_id);
end $$;
revoke all on function private.invoice_receipt_receivers(uuid,uuid[]) from public,anon;
grant execute on function private.invoice_receipt_receivers(uuid,uuid[]) to authenticated;
create or replace function public.invoice_receipt_receivers(p_organization_id uuid,p_receipt_ids uuid[])
returns table(receipt_id uuid,received_by_name text)
language sql stable security invoker set search_path='' as $$
 select * from private.invoice_receipt_receivers(p_organization_id,p_receipt_ids);
$$;
revoke all on function public.invoice_receipt_receivers(uuid,uuid[]) from public,anon;
grant execute on function public.invoice_receipt_receivers(uuid,uuid[]) to authenticated;
