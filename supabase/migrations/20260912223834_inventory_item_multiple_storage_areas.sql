CREATE TABLE public.inventory_item_storage_areas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 location_id uuid NOT NULL REFERENCES public.locations(id),
 inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
 storage_area_id uuid NOT NULL REFERENCES public.storage_areas(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(inventory_item_id,storage_area_id),
 FOREIGN KEY(location_id,inventory_item_id) REFERENCES public.location_inventory_items(location_id,inventory_item_id)
);
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.inventory_item_storage_areas FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.inventory_item_storage_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_item_storage_areas FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_item_storage_areas TO authenticated,service_role;
CREATE POLICY rm2_select ON public.inventory_item_storage_areas FOR SELECT TO authenticated USING(private.is_org_member(organization_id) AND private.can_location(location_id) AND private.can_storage(storage_area_id));
CREATE POLICY rm2_write ON public.inventory_item_storage_areas FOR ALL TO authenticated USING(private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]) AND private.can_location(location_id) AND private.can_storage(storage_area_id)) WITH CHECK(private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]) AND private.can_location(location_id) AND private.can_storage(storage_area_id));
CREATE INDEX inventory_item_storage_areas_location_idx ON public.inventory_item_storage_areas(location_id,inventory_item_id);
CREATE INDEX inventory_item_storage_areas_area_idx ON public.inventory_item_storage_areas(storage_area_id);
COMMENT ON TABLE public.inventory_item_storage_areas IS 'Storage area assignments for inventory items, allowing multiple areas per item and location. Does not create or move stock.';
;
