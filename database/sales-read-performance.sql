-- Same membership, role and location restrictions; uncorrelated sets are evaluated once.
-- Location visibility remains governed by locations.rm2_select (is_org_member + can_location).
alter policy rm2_select on public.sales_item_facts to authenticated using (
 organization_id in (select m.organization_id from public.organization_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin','manager'))
 and (location_id is null or location_id in (select l.id from public.locations l))
);
