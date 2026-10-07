alter table public.invoices
  alter column location_id set not null;

alter table public.purchase_receipts
  alter column location_id set not null;

create index if not exists invoices_organization_location_created_at_idx
  on public.invoices (organization_id, location_id, created_at desc);

create index if not exists purchase_receipts_organization_location_received_at_idx
  on public.purchase_receipts (organization_id, location_id, received_at desc);

drop policy if exists rm2_select on public.invoices;
create policy rm2_select on public.invoices
for select to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and ((supplier_id is null) or private.can_supplier(supplier_id))
  and private.has_org_role(organization_id, array['owner'::member_role, 'admin'::member_role, 'manager'::member_role])
);

drop policy if exists rm2_select on public.purchase_receipts;
create policy rm2_select on public.purchase_receipts
for select to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and ((supplier_id is null) or private.can_supplier(supplier_id))
  and private.has_org_role(organization_id, array['owner'::member_role, 'admin'::member_role, 'manager'::member_role])
);
;
