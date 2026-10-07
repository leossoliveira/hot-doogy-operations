ALTER TABLE public.menu_categories ADD COLUMN parent_id uuid;
ALTER TABLE public.menu_categories ADD CONSTRAINT menu_categories_org_id_unique UNIQUE(organization_id,id);
ALTER TABLE public.menu_categories ADD CONSTRAINT menu_categories_parent_scope_fk FOREIGN KEY(organization_id,parent_id) REFERENCES public.menu_categories(organization_id,id);
ALTER TABLE public.menu_categories ADD CONSTRAINT menu_categories_not_self_parent CHECK(parent_id IS DISTINCT FROM id);
CREATE INDEX menu_categories_parent_idx ON public.menu_categories(organization_id,parent_id);
COMMENT ON COLUMN public.menu_categories.parent_id IS 'Parent menu category. NULL identifies a top-level category.';
;
