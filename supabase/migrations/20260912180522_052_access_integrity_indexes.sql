SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(727002);
-- Complete the sample RLS with least-privilege client access.
-- Workflow writes remain backend-only until atomic posting functions exist.
CREATE FUNCTION private.can_location(target_location uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.locations l JOIN public.organization_members m ON m.organization_id=l.organization_id
  WHERE l.id=target_location AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND (m.role IN ('owner','admin') OR EXISTS (
    SELECT 1 FROM public.member_location_access a WHERE a.member_id=m.id AND a.location_id=l.id))
 );
$$;
CREATE FUNCTION private.can_storage(target_storage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.storage_areas s JOIN public.organization_members m ON m.organization_id=s.organization_id
  WHERE s.id=target_storage AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND private.can_location(s.location_id)
  AND (m.role IN ('owner','admin','manager','chef') OR EXISTS (
   SELECT 1 FROM public.member_storage_area_access a WHERE a.member_id=m.id AND a.storage_area_id=s.id AND a.can_view))
 );
$$;
CREATE FUNCTION private.can_supplier(target_supplier uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.suppliers s JOIN public.organization_members m ON m.organization_id=s.organization_id
  WHERE s.id=target_supplier AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND (m.role IN ('owner','admin','manager') OR EXISTS (
   SELECT 1 FROM public.member_supplier_access a WHERE a.member_id=m.id AND a.supplier_id=s.id AND a.can_view))
 );
$$;
REVOKE ALL ON FUNCTION private.can_location(uuid),private.can_storage(uuid),private.can_supplier(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.can_location(uuid),private.can_storage(uuid),private.can_supplier(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC,anon,authenticated;

-- Prevent relationships across tenants or locations, including join tables.
-- Invoker rights intentionally require referenced rows to be visible to the writer.
CREATE FUNCTION private.validate_relationship_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 doc jsonb := to_jsonb(NEW); parent_doc jsonb; fk record;
 org uuid := (doc->>'organization_id')::uuid;
 loc uuid := (doc->>'location_id')::uuid;
 parent_org uuid; parent_loc uuid;
 item uuid := coalesce((doc->>'inventory_item_id')::uuid,(doc->>'component_inventory_item_id')::uuid);
 unit_item uuid;
BEGIN
 IF TG_OP='UPDATE' AND doc ? 'organization_id' AND (to_jsonb(OLD)->>'organization_id') IS DISTINCT FROM doc->>'organization_id' THEN
  RAISE EXCEPTION 'organization_id is immutable' USING ERRCODE='23514';
 END IF;
 FOR fk IN
  SELECT c.confrelid::regclass AS target, pc.relname AS target_name,
         ca.attname AS source_column,pa.attname AS target_column
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class pc ON pc.oid=c.confrelid
  JOIN pg_catalog.pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=c.conkey[1]
  JOIN pg_catalog.pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=c.confkey[1]
  WHERE c.conrelid=TG_RELID AND c.contype='f' AND cardinality(c.conkey)=1
   AND pc.relnamespace='public'::regnamespace
  ORDER BY CASE WHEN pc.relname='inventory_item_units' THEN 1 ELSE 0 END,c.oid
 LOOP
  IF doc->>fk.source_column IS NULL THEN CONTINUE; END IF;
  EXECUTE format('SELECT to_jsonb(p) FROM %s p WHERE %I=$1',fk.target,fk.target_column)
   INTO parent_doc USING (doc->>fk.source_column)::uuid;
  IF parent_doc IS NULL THEN RAISE EXCEPTION 'Missing or inaccessible reference: %.%',TG_TABLE_NAME,fk.source_column USING ERRCODE='23503'; END IF;
  parent_org:=CASE WHEN fk.target_name='organizations' THEN (parent_doc->>'id')::uuid ELSE (parent_doc->>'organization_id')::uuid END;
  parent_loc:=CASE WHEN fk.target_name='locations' THEN (parent_doc->>'id')::uuid ELSE (parent_doc->>'location_id')::uuid END;
  IF parent_org IS NOT NULL THEN
   IF org IS NOT NULL AND org<>parent_org THEN RAISE EXCEPTION 'Cross-organization reference: %.%',TG_TABLE_NAME,fk.source_column USING ERRCODE='23514'; END IF;
   org:=coalesce(org,parent_org);
  END IF;
  IF parent_loc IS NOT NULL THEN
   IF loc IS NOT NULL AND loc<>parent_loc THEN RAISE EXCEPTION 'Cross-location reference: %.%',TG_TABLE_NAME,fk.source_column USING ERRCODE='23514'; END IF;
   loc:=coalesce(loc,parent_loc);
  END IF;
  IF fk.target_name IN ('purchase_order_lines','stock_count_lines') AND item IS NULL THEN item:=(parent_doc->>'inventory_item_id')::uuid; END IF;
  IF fk.target_name='inventory_item_units' AND item IS NOT NULL THEN
   unit_item:=(parent_doc->>'inventory_item_id')::uuid;
   IF item<>unit_item THEN RAISE EXCEPTION 'Unit belongs to another inventory item' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_relationship_scope() FROM PUBLIC,anon,authenticated;

-- Ledger and audit history are append-only. Corrections are compensating entries.
CREATE FUNCTION private.reject_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 RAISE EXCEPTION '% is append-only; record a compensating entry instead',TG_TABLE_NAME USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION private.reject_history_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_history_append_only BEFORE UPDATE OR DELETE ON public.inventory_transactions FOR EACH ROW EXECUTE FUNCTION private.reject_history_mutation();
CREATE TRIGGER audit_history_append_only BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION private.reject_history_mutation();

-- Basic integrity rules missing from the draft.
CREATE UNIQUE INDEX units_global_code_unique ON public.units(code) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX units_org_code_unique ON public.units(organization_id,code) WHERE organization_id IS NOT NULL;
ALTER TABLE public.units ADD CONSTRAINT units_scope_check CHECK ((organization_id IS NULL AND is_system) OR (organization_id IS NOT NULL AND NOT is_system));
CREATE UNIQUE INDEX inventory_single_base_unit ON public.inventory_item_units(inventory_item_id) WHERE is_base_unit;
ALTER TABLE public.inventory_item_units ADD CONSTRAINT base_unit_quantity_check CHECK (NOT is_base_unit OR quantity_in_base_unit=1);
ALTER TABLE public.inventory_transfers ADD CONSTRAINT transfer_distinct_areas CHECK (from_storage_area_id<>to_storage_area_id);
ALTER TABLE public.recipe_versions ADD CONSTRAINT recipe_yield_positive CHECK(yield_quantity IS NULL OR yield_quantity>0);
ALTER TABLE public.recipe_versions ADD CONSTRAINT recipe_effective_period CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>effective_from);
ALTER TABLE public.recipe_components ADD CONSTRAINT recipe_waste_fraction CHECK(waste_percent>=0 AND waste_percent<1);
ALTER TABLE public.menu_item_forecasts ADD CONSTRAINT forecast_nonnegative CHECK(forecast_quantity>=0);
ALTER TABLE public.menu_item_forecasts ADD CONSTRAINT forecast_confidence CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1));
CREATE UNIQUE INDEX inventory_targets_location_default_unique ON public.inventory_targets(location_id,inventory_item_id) WHERE storage_area_id IS NULL;
ALTER TABLE public.sales_import_batches ADD CONSTRAINT import_counts_nonnegative CHECK(total_rows>=0 AND processed_rows>=0 AND error_rows>=0);
ALTER TABLE public.sales_import_batches ADD CONSTRAINT import_hash_nonempty CHECK(file_hash IS NULL OR length(btrim(file_hash))>0);
ALTER TABLE public.sales_item_facts ADD CONSTRAINT item_fact_date_granularity CHECK ((granularity='day' AND fact_date IS NOT NULL) OR (granularity IN ('week','month','period') AND fact_date IS NULL) OR granularity IN ('transaction','hour'));
ALTER TABLE public.sales_modifier_facts ADD CONSTRAINT modifier_fact_date_granularity CHECK ((granularity='day' AND fact_date IS NOT NULL) OR (granularity IN ('week','month','period') AND fact_date IS NULL) OR granularity IN ('transaction','hour'));
-- Use a stable tiebreaker for same-time approved prices.
CREATE OR REPLACE VIEW public.v_current_supplier_prices WITH (security_invoker=true) AS
 SELECT DISTINCT ON(supplier_item_id,location_id) supplier_item_id,location_id,price_per_purchase_unit,effective_at
 FROM public.supplier_item_price_history WHERE status='approved'
 ORDER BY supplier_item_id,location_id,effective_at DESC,created_at DESC,id DESC;


ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organizations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.organizations TO service_role;
CREATE POLICY rm2_select ON public.organizations FOR SELECT TO authenticated USING (private.is_org_member(id));
GRANT UPDATE ON public.organizations TO authenticated;
CREATE POLICY rm2_update ON public.organizations FOR UPDATE TO authenticated USING (private.has_org_role(id,ARRAY['owner','admin']::public.member_role[])) WITH CHECK (private.has_org_role(id,ARRAY['owner','admin']::public.member_role[]));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles TO service_role;
CREATE POLICY rm2_select ON public.profiles FOR SELECT TO authenticated USING (id=(SELECT auth.uid()));
GRANT UPDATE ON public.profiles TO authenticated;
CREATE POLICY rm2_update ON public.profiles FOR UPDATE TO authenticated USING (id=(SELECT auth.uid())) WITH CHECK (id=(SELECT auth.uid()));

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_members FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.organization_members TO service_role;
CREATE POLICY rm2_select ON public.organization_members FOR SELECT TO authenticated USING ((user_id=(SELECT auth.uid()) OR private.has_org_role(organization_id,ARRAY['owner','admin']::public.member_role[])));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.locations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.locations TO service_role;
CREATE POLICY rm2_select ON public.locations FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND private.can_location(id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.member_location_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_location_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.member_location_access TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.member_location_access TO service_role;
CREATE POLICY rm2_select ON public.member_location_access FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.organization_members m WHERE m.id=member_location_access.member_id AND (m.user_id=(SELECT auth.uid()) OR private.has_org_role(m.organization_id,ARRAY['owner','admin']::public.member_role[]))));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.member_location_access FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.location_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.location_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.location_settings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.location_settings TO service_role;
CREATE POLICY rm2_select ON public.location_settings FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.location_settings FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.departments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.departments TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.departments TO service_role;
CREATE POLICY rm2_select ON public.departments FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.storage_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_areas FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.storage_areas TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.storage_areas TO service_role;
CREATE POLICY rm2_select ON public.storage_areas FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.can_storage(id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.storage_areas FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.member_storage_area_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_storage_area_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.member_storage_area_access TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.member_storage_area_access TO service_role;
CREATE POLICY rm2_select ON public.member_storage_area_access FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.organization_members m WHERE m.id=member_storage_area_access.member_id AND (m.user_id=(SELECT auth.uid()) OR private.has_org_role(m.organization_id,ARRAY['owner','admin']::public.member_role[]))));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.member_storage_area_access FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.member_supplier_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_supplier_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.member_supplier_access TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.member_supplier_access TO service_role;
CREATE POLICY rm2_select ON public.member_supplier_access FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.organization_members m WHERE m.id=member_supplier_access.member_id AND (m.user_id=(SELECT auth.uid()) OR private.has_org_role(m.organization_id,ARRAY['owner','admin']::public.member_role[]))));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.member_supplier_access FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.units FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.units TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.units TO service_role;
CREATE POLICY rm2_select ON public.units FOR SELECT TO authenticated USING (((organization_id IS NULL AND is_system) OR private.is_org_member(organization_id)));
GRANT UPDATE ON public.units TO authenticated;
CREATE POLICY rm2_update ON public.units FOR UPDATE TO authenticated USING (organization_id IS NOT NULL AND NOT is_system AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (organization_id IS NOT NULL AND NOT is_system AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.units TO authenticated;
CREATE POLICY rm2_insert ON public.units FOR INSERT TO authenticated WITH CHECK (organization_id IS NOT NULL AND NOT is_system AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_categories FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_categories TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_categories TO service_role;
CREATE POLICY rm2_select ON public.inventory_categories FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.inventory_categories TO authenticated;
CREATE POLICY rm2_update ON public.inventory_categories FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.inventory_categories TO authenticated;
CREATE POLICY rm2_insert ON public.inventory_categories FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_categories FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_items TO service_role;
GRANT INSERT,UPDATE ON public.inventory_items TO authenticated;
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_item_units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_item_units FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_item_units TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_item_units TO service_role;
CREATE POLICY rm2_select ON public.inventory_item_units FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.inventory_item_units TO authenticated;
CREATE POLICY rm2_update ON public.inventory_item_units FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.inventory_item_units TO authenticated;
CREATE POLICY rm2_insert ON public.inventory_item_units FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_item_units FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.location_inventory_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.location_inventory_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.location_inventory_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.location_inventory_items TO service_role;
CREATE POLICY rm2_select ON public.location_inventory_items FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (default_storage_area_id IS NULL OR private.can_storage(default_storage_area_id)));
GRANT UPDATE ON public.location_inventory_items TO authenticated;
CREATE POLICY rm2_update ON public.location_inventory_items FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (default_storage_area_id IS NULL OR private.can_storage(default_storage_area_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (default_storage_area_id IS NULL OR private.can_storage(default_storage_area_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.location_inventory_items TO authenticated;
CREATE POLICY rm2_insert ON public.location_inventory_items FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (default_storage_area_id IS NULL OR private.can_storage(default_storage_area_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.location_inventory_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tags FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tags TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tags TO service_role;
CREATE POLICY rm2_select ON public.tags FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.tags TO authenticated;
CREATE POLICY rm2_update ON public.tags FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.tags TO authenticated;
CREATE POLICY rm2_insert ON public.tags FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_item_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_item_tags FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_item_tags TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_item_tags TO service_role;
CREATE POLICY rm2_select ON public.inventory_item_tags FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.inventory_items p WHERE p.id=inventory_item_tags.inventory_item_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_item_tags FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.supplier_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_categories FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.supplier_categories TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.supplier_categories TO service_role;
CREATE POLICY rm2_select ON public.supplier_categories FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.supplier_categories TO authenticated;
CREATE POLICY rm2_update ON public.supplier_categories FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
GRANT INSERT ON public.supplier_categories TO authenticated;
CREATE POLICY rm2_insert ON public.supplier_categories FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.supplier_categories FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.suppliers TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.suppliers TO service_role;
CREATE POLICY rm2_select ON public.suppliers FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND private.can_supplier(id));
GRANT UPDATE ON public.suppliers TO authenticated;
CREATE POLICY rm2_update ON public.suppliers FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.can_supplier(id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.can_supplier(id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
GRANT INSERT ON public.suppliers TO authenticated;
CREATE POLICY rm2_insert ON public.suppliers FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.can_supplier(id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_contacts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.supplier_contacts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.supplier_contacts TO service_role;
CREATE POLICY rm2_select ON public.supplier_contacts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.suppliers p WHERE p.id=supplier_contacts.supplier_id) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.supplier_contacts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.supplier_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.supplier_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.supplier_items TO service_role;
CREATE POLICY rm2_select ON public.supplier_items FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)));
GRANT UPDATE ON public.supplier_items TO authenticated;
CREATE POLICY rm2_update ON public.supplier_items FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
GRANT INSERT ON public.supplier_items TO authenticated;
CREATE POLICY rm2_insert ON public.supplier_items FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.supplier_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.purchase_orders TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_orders TO service_role;
CREATE POLICY rm2_select ON public.purchase_orders FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_order_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.purchase_order_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_order_lines TO service_role;
CREATE POLICY rm2_select ON public.purchase_order_lines FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id=purchase_order_lines.purchase_order_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.purchase_order_stock_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_order_stock_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.purchase_order_stock_entries TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_order_stock_entries TO service_role;
CREATE POLICY rm2_select ON public.purchase_order_stock_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.purchase_order_lines p WHERE p.id=purchase_order_stock_entries.purchase_order_line_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.purchase_order_stock_entries FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.purchase_receipts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_receipts TO service_role;
CREATE POLICY rm2_select ON public.purchase_receipts FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.purchase_receipts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.purchase_receipt_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_receipt_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.purchase_receipt_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_receipt_lines TO service_role;
CREATE POLICY rm2_select ON public.purchase_receipt_lines FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.purchase_receipts p WHERE p.id=purchase_receipt_lines.receipt_id) AND (storage_area_id IS NULL OR private.can_storage(storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoices TO service_role;
CREATE POLICY rm2_select ON public.invoices FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (supplier_id IS NULL OR private.can_supplier(supplier_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.invoice_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoice_documents TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoice_documents TO service_role;
CREATE POLICY rm2_select ON public.invoice_documents FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.invoices p WHERE p.id=invoice_documents.invoice_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.invoice_documents FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoice_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoice_lines TO service_role;
CREATE POLICY rm2_select ON public.invoice_lines FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.invoices p WHERE p.id=invoice_lines.invoice_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.supplier_item_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_item_price_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.supplier_item_price_history TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.supplier_item_price_history TO service_role;
CREATE POLICY rm2_select ON public.supplier_item_price_history FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.supplier_item_price_history FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_item_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_item_cost_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_item_cost_history TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_item_cost_history TO service_role;
CREATE POLICY rm2_select ON public.inventory_item_cost_history FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_item_cost_history FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.recipes TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.recipes TO service_role;
CREATE POLICY rm2_select ON public.recipes FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.recipe_versions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.recipe_versions TO service_role;
CREATE POLICY rm2_select ON public.recipe_versions FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.recipes p WHERE p.id=recipe_versions.recipe_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.recipe_versions FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.recipe_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_components FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.recipe_components TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.recipe_components TO service_role;
CREATE POLICY rm2_select ON public.recipe_components FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.recipe_versions p WHERE p.id=recipe_components.recipe_version_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.recipe_components FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.recipe_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_steps FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.recipe_steps TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.recipe_steps TO service_role;
CREATE POLICY rm2_select ON public.recipe_steps FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.recipe_versions p WHERE p.id=recipe_steps.recipe_version_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.recipe_steps FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_categories FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.menu_categories TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_categories TO service_role;
CREATE POLICY rm2_select ON public.menu_categories FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.menu_categories TO authenticated;
CREATE POLICY rm2_update ON public.menu_categories FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.menu_categories TO authenticated;
CREATE POLICY rm2_insert ON public.menu_categories FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.menu_categories FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.menu_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_items TO service_role;
CREATE POLICY rm2_select ON public.menu_items FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.menu_items TO authenticated;
CREATE POLICY rm2_update ON public.menu_items FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.menu_items TO authenticated;
CREATE POLICY rm2_insert ON public.menu_items FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.menu_item_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_item_prices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.menu_item_prices TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_item_prices TO service_role;
CREATE POLICY rm2_select ON public.menu_item_prices FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.menu_item_prices FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.modifiers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.modifiers TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.modifiers TO service_role;
CREATE POLICY rm2_select ON public.modifiers FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.modifiers TO authenticated;
CREATE POLICY rm2_update ON public.modifiers FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.modifiers TO authenticated;
CREATE POLICY rm2_insert ON public.modifiers FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.modifiers FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.menu_item_modifier_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_item_modifier_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.menu_item_modifier_rules TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_item_modifier_rules TO service_role;
CREATE POLICY rm2_select ON public.menu_item_modifier_rules FOR SELECT TO authenticated USING (private.is_org_member(organization_id));
GRANT UPDATE ON public.menu_item_modifier_rules TO authenticated;
CREATE POLICY rm2_update ON public.menu_item_modifier_rules FOR UPDATE TO authenticated USING (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[])) WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
GRANT INSERT ON public.menu_item_modifier_rules TO authenticated;
CREATE POLICY rm2_insert ON public.menu_item_modifier_rules FOR INSERT TO authenticated WITH CHECK (private.is_org_member(organization_id) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.menu_item_modifier_rules FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.pos_item_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_item_mappings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pos_item_mappings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.pos_item_mappings TO service_role;
CREATE POLICY rm2_select ON public.pos_item_mappings FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.pos_item_mappings FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.pos_modifier_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_modifier_mappings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pos_modifier_mappings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.pos_modifier_mappings TO service_role;
CREATE POLICY rm2_select ON public.pos_modifier_mappings FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.pos_modifier_mappings FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.sales_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_import_batches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_import_batches TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_import_batches TO service_role;
CREATE POLICY rm2_select ON public.sales_import_batches FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_import_batches FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.sales_import_batches ADD CONSTRAINT rm2_valid_period CHECK(period_end>period_start);

ALTER TABLE public.sales_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_import_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_import_rows TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_import_rows TO service_role;
CREATE POLICY rm2_select ON public.sales_import_rows FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.sales_import_batches p WHERE p.id=sales_import_rows.batch_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_import_rows FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.sales_item_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_item_facts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_item_facts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_item_facts TO service_role;
CREATE POLICY rm2_select ON public.sales_item_facts FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_item_facts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.sales_item_facts ADD CONSTRAINT rm2_valid_period CHECK(period_end>period_start);

ALTER TABLE public.sales_modifier_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_modifier_facts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_modifier_facts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_modifier_facts TO service_role;
CREATE POLICY rm2_select ON public.sales_modifier_facts FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_modifier_facts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.sales_modifier_facts ADD CONSTRAINT rm2_valid_period CHECK(period_end>period_start);

ALTER TABLE public.sales_summary_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_summary_facts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_summary_facts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_summary_facts TO service_role;
CREATE POLICY rm2_select ON public.sales_summary_facts FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_summary_facts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.sales_summary_facts ADD CONSTRAINT rm2_valid_period CHECK(period_end>period_start);

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_orders TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_orders TO service_role;
CREATE POLICY rm2_select ON public.sales_orders FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_order_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_order_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_order_items TO service_role;
CREATE POLICY rm2_select ON public.sales_order_items FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.sales_orders p WHERE p.id=sales_order_items.sales_order_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.sales_order_modifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_order_modifiers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_order_modifiers TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_order_modifiers TO service_role;
CREATE POLICY rm2_select ON public.sales_order_modifiers FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.sales_order_items p WHERE p.id=sales_order_modifiers.sales_order_item_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.sales_order_modifiers FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_transactions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_transactions TO service_role;
CREATE POLICY rm2_select ON public.inventory_transactions FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (storage_area_id IS NULL OR private.can_storage(storage_area_id)) AND private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_transactions FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_targets FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_targets TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_targets TO service_role;
CREATE POLICY rm2_select ON public.inventory_targets FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (storage_area_id IS NULL OR private.can_storage(storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_targets FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_counts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_counts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.stock_counts TO service_role;
CREATE POLICY rm2_select ON public.stock_counts FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (filter_storage_area_id IS NULL OR private.can_storage(filter_storage_area_id)) AND (filter_supplier_id IS NULL OR private.can_supplier(filter_supplier_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.stock_counts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_count_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_count_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.stock_count_lines TO service_role;
CREATE POLICY rm2_select ON public.stock_count_lines FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.stock_counts p WHERE p.id=stock_count_lines.stock_count_id) AND (storage_area_id IS NULL OR private.can_storage(storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.stock_count_lines FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.stock_count_line_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_count_line_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_count_line_entries TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.stock_count_line_entries TO service_role;
CREATE POLICY rm2_select ON public.stock_count_line_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.stock_count_lines p WHERE p.id=stock_count_line_entries.stock_count_line_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.stock_count_line_entries FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.waste_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waste_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.waste_events TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.waste_events TO service_role;
CREATE POLICY rm2_select ON public.waste_events FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.waste_events FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.waste_event_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waste_event_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.waste_event_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.waste_event_lines TO service_role;
CREATE POLICY rm2_select ON public.waste_event_lines FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.waste_events p WHERE p.id=waste_event_lines.waste_event_id) AND (storage_area_id IS NULL OR private.can_storage(storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.waste_event_lines FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_transfers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_transfers TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_transfers TO service_role;
CREATE POLICY rm2_select ON public.inventory_transfers FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (from_storage_area_id IS NULL OR private.can_storage(from_storage_area_id)) AND (to_storage_area_id IS NULL OR private.can_storage(to_storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_transfers FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.inventory_transfer_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_transfer_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_transfer_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_transfer_lines TO service_role;
CREATE POLICY rm2_select ON public.inventory_transfer_lines FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.inventory_transfers p WHERE p.id=inventory_transfer_lines.transfer_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_transfer_lines FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.prep_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prep_plans FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prep_plans TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.prep_plans TO service_role;
CREATE POLICY rm2_select ON public.prep_plans FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.prep_plans FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.prep_plans ADD CONSTRAINT rm2_valid_period CHECK(period_end>period_start);

ALTER TABLE public.prep_plan_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prep_plan_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prep_plan_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.prep_plan_items TO service_role;
CREATE POLICY rm2_select ON public.prep_plan_items FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.prep_plans p WHERE p.id=prep_plan_items.prep_plan_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.prep_plan_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.prep_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prep_batches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prep_batches TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.prep_batches TO service_role;
CREATE POLICY rm2_select ON public.prep_batches FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND (output_storage_area_id IS NULL OR private.can_storage(output_storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.prep_batches FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.prep_batch_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prep_batch_components FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prep_batch_components TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.prep_batch_components TO service_role;
CREATE POLICY rm2_select ON public.prep_batch_components FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND EXISTS (SELECT 1 FROM public.prep_batches p WHERE p.id=prep_batch_components.prep_batch_id) AND (storage_area_id IS NULL OR private.can_storage(storage_area_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.prep_batch_components FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.menu_item_forecasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_item_forecasts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.menu_item_forecasts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_item_forecasts TO service_role;
CREATE POLICY rm2_select ON public.menu_item_forecasts FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.menu_item_forecasts FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.menu_item_forecasts ADD CONSTRAINT rm2_valid_period CHECK(period_end>period_start);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_conversations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_conversations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_conversations TO service_role;
CREATE POLICY rm2_select ON public.ai_conversations FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (location_id IS NULL OR private.can_location(location_id)) AND user_id=(SELECT auth.uid()));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_messages TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_messages TO service_role;
CREATE POLICY rm2_select ON public.ai_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.ai_conversations p WHERE p.id=ai_messages.conversation_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.ai_messages FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_actions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_actions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_actions TO service_role;
CREATE POLICY rm2_select ON public.ai_actions FOR SELECT TO authenticated USING (private.is_org_member(organization_id) AND (requested_by=(SELECT auth.uid()) OR private.has_org_role(organization_id,ARRAY['owner','admin']::public.member_role[])));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.ai_actions FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_logs TO service_role;
CREATE POLICY rm2_select ON public.audit_logs FOR SELECT TO authenticated USING (private.has_org_role(organization_id,ARRAY['owner','admin']::public.member_role[]));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();

REVOKE UPDATE,DELETE,TRUNCATE ON public.inventory_transactions,public.audit_logs FROM service_role;
GRANT USAGE,SELECT ON SEQUENCE public.audit_logs_id_seq TO service_role;
GRANT SELECT ON public.v_live_inventory,public.v_current_supplier_prices TO authenticated;
-- Cover every foreign key with an index whose leading columns match it.
DO $$ DECLARE fk record; cols text; BEGIN
 FOR fk IN SELECT c.* FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=fk.conrelid AND i.indisvalid AND i.indpred IS NULL
     AND ARRAY(SELECT attnum FROM unnest(i.indkey) WITH ORDINALITY x(attnum,ord) WHERE ord<=cardinality(fk.conkey) ORDER BY ord)=fk.conkey) THEN
   SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.ord) INTO cols
    FROM unnest(fk.conkey) WITH ORDINALITY k(attnum,ord)
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k.attnum;
   EXECUTE format('CREATE INDEX %I ON %s (%s)','rm2_fk_'||fk.oid,fk.conrelid::regclass,cols);
  END IF;
 END LOOP;
END $$;

;
