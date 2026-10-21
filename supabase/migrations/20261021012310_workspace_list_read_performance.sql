-- Preserve read permissions; compute authorized sets once per statement instead of once per row.
-- Parent subqueries remain subject to their own RLS, including MFA and staff restrictions.
-- No write policies, grants, auth helpers, business rows or public endpoints change.
SET lock_timeout = '5s';

ALTER POLICY rm2_select ON public.inventory_categories USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.inventory_item_storage_areas USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (location_id IN (SELECT permitted.id FROM public.locations permitted)) AND (storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted)))
);

ALTER POLICY rm2_select ON public.inventory_item_units USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.inventory_transactions USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND ((storage_area_id IS NULL) OR (storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role, 'chef'::member_role]))))
);

ALTER POLICY rm2_select ON public.invoice_documents USING (
 (invoice_documents.invoice_id IN (SELECT p.id FROM public.invoices p))
);

ALTER POLICY rm2_select ON public.invoice_lines USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (invoice_lines.invoice_id IN (SELECT p.id FROM public.invoices p)))
);

ALTER POLICY rm2_select ON public.invoices USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (location_id IN (SELECT permitted.id FROM public.locations permitted)) AND ((supplier_id IS NULL) OR (supplier_id IN (SELECT permitted.id FROM public.suppliers permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role]))))
);

ALTER POLICY rm2_select ON public.location_inventory_items USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND ((default_storage_area_id IS NULL) OR (default_storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))))
);

ALTER POLICY rm2_select ON public.location_menu_items USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (location_id IN (SELECT permitted.id FROM public.locations permitted)))
);

ALTER POLICY rm2_select ON public.location_settings USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))))
);

ALTER POLICY rm2_select ON public.locations USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND private.can_location(id))
);

ALTER POLICY rm2_select ON public.menu_categories USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.menu_item_modifier_rules USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.menu_item_prices USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role]))))
);

ALTER POLICY rm2_select ON public.menu_items USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.modifiers USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.pos_modifier_mappings USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))))
);

ALTER POLICY rm2_select ON public.prep_batch_components USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (prep_batch_components.prep_batch_id IN (SELECT p.id FROM public.prep_batches p)) AND ((storage_area_id IS NULL) OR (storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))))
);

ALTER POLICY rm2_select ON public.prep_batches USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND ((output_storage_area_id IS NULL) OR (output_storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))))
);

ALTER POLICY rm2_select ON public.purchase_order_lines USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (purchase_order_lines.purchase_order_id IN (SELECT p.id FROM public.purchase_orders p)))
);

ALTER POLICY rm2_select ON public.purchase_orders USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND ((supplier_id IS NULL) OR (supplier_id IN (SELECT permitted.id FROM public.suppliers permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role]))))
);

ALTER POLICY rm2_select ON public.purchase_receipt_lines USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (purchase_receipt_lines.receipt_id IN (SELECT p.id FROM public.purchase_receipts p)) AND ((storage_area_id IS NULL) OR (storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))))
);

ALTER POLICY rm2_select ON public.purchase_receipts USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (location_id IN (SELECT permitted.id FROM public.locations permitted)) AND ((supplier_id IS NULL) OR (supplier_id IN (SELECT permitted.id FROM public.suppliers permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role]))))
);

ALTER POLICY rm2_select ON public.recipe_components USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (recipe_components.recipe_version_id IN (SELECT p.id FROM public.recipe_versions p)))
);

ALTER POLICY rm2_select ON public.recipe_steps USING (
 (recipe_steps.recipe_version_id IN (SELECT p.id FROM public.recipe_versions p))
);

ALTER POLICY rm2_select ON public.recipe_versions USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (recipe_versions.recipe_id IN (SELECT p.id FROM public.recipes p)))
);

ALTER POLICY rm2_select ON public.recipes USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.sales_import_batches USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role]))))
);

ALTER POLICY rm2_select ON public.stock_count_line_entries USING (
 (stock_count_line_entries.stock_count_line_id IN (SELECT p.id FROM public.stock_count_lines p))
);

ALTER POLICY rm2_select ON public.stock_count_lines USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND (stock_count_lines.stock_count_id IN (SELECT p.id FROM public.stock_counts p)) AND ((storage_area_id IS NULL) OR (storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))))
);

ALTER POLICY rm2_select ON public.stock_counts USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND ((filter_storage_area_id IS NULL) OR (filter_storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))) AND ((filter_supplier_id IS NULL) OR (filter_supplier_id IN (SELECT permitted.id FROM public.suppliers permitted))))
);

ALTER POLICY rm2_select ON public.storage_areas USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND private.can_storage(id))
);

ALTER POLICY rm2_select ON public.supplier_categories USING (
 (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active'))
);

ALTER POLICY rm2_select ON public.supplier_item_price_history USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))) AND (organization_id IN (SELECT access_role.organization_id FROM public.organization_members access_role WHERE access_role.user_id=(SELECT auth.uid()) AND access_role.status='active' AND access_role.role=ANY(ARRAY['owner'::member_role, 'admin'::member_role, 'manager'::member_role]))))
);

ALTER POLICY rm2_select ON public.supplier_items USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((supplier_id IS NULL) OR (supplier_id IN (SELECT permitted.id FROM public.suppliers permitted))))
);

ALTER POLICY rm2_select ON public.suppliers USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND private.can_supplier(id))
);

ALTER POLICY rm2_select ON public.units USING (
 (((organization_id IS NULL) AND is_system) OR (organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')))
);

ALTER POLICY rm2_select ON public.waste_event_lines USING (
 ((waste_event_lines.waste_event_id IN (SELECT p.id FROM public.waste_events p)) AND ((storage_area_id IS NULL) OR (storage_area_id IN (SELECT permitted.id FROM public.storage_areas permitted))))
);

ALTER POLICY rm2_select ON public.waste_events USING (
 ((organization_id IN (SELECT access_member.organization_id FROM public.organization_members access_member WHERE access_member.user_id=(SELECT auth.uid()) AND access_member.status='active')) AND ((location_id IS NULL) OR (location_id IN (SELECT permitted.id FROM public.locations permitted))))
);
