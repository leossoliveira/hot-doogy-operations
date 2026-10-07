CREATE TABLE public.location_menu_items(
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES public.organizations(id),
location_id uuid NOT NULL REFERENCES public.locations(id),
menu_item_id uuid NOT NULL REFERENCES public.menu_items(id),
active boolean NOT NULL DEFAULT true,
UNIQUE(location_id,menu_item_id));
CREATE TRIGGER rm2_relationship_scope BEFORE INSERT OR UPDATE ON public.location_menu_items FOR EACH ROW EXECUTE FUNCTION private.validate_relationship_scope();
ALTER TABLE public.location_menu_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.location_menu_items TO authenticated,service_role;
CREATE POLICY rm2_select ON public.location_menu_items FOR SELECT TO authenticated USING(private.is_org_member(organization_id) AND private.can_location(location_id));
CREATE POLICY rm2_write ON public.location_menu_items FOR ALL TO authenticated USING(private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]) AND private.can_location(location_id)) WITH CHECK(private.has_org_role(organization_id,ARRAY['owner','admin','manager','chef']::public.member_role[]) AND private.can_location(location_id));
CREATE INDEX location_menu_items_item_idx ON public.location_menu_items(menu_item_id);
;
