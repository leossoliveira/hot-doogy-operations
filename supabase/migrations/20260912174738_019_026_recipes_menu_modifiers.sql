SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
DO $$ DECLARE obj text; BEGIN FOREACH obj IN ARRAY ARRAY['public.recipes','public.recipe_versions','public.recipe_components','public.recipe_steps','public.menu_categories','public.menu_items','public.menu_item_prices','public.modifiers','public.menu_item_modifier_rules'] LOOP IF to_regclass(obj) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing object %, inspect before applying',obj; END IF; END LOOP; END $$;
-- Original section 19: Recipes
create table public.recipes (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  name text not null,

  recipe_type public.recipe_type not null,

  output_inventory_item_id uuid
    references public.inventory_items(id),

  description text,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Original section 20: Recipe Versions
create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  recipe_id uuid not null
    references public.recipes(id) on delete cascade,

  version_number integer not null,

  status public.recipe_status
    not null default 'draft',

  effective_from timestamptz,
  effective_to timestamptz,

  yield_quantity numeric(18,6),

  yield_item_unit_id uuid
    references public.inventory_item_units(id),

  notes text,

  created_by uuid
    references auth.users(id),

  created_at timestamptz not null default now(),

  unique(recipe_id, version_number)
);

-- Original section 21: Recipe Components
create table public.recipe_components (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  recipe_version_id uuid not null
    references public.recipe_versions(id) on delete cascade,

  component_inventory_item_id uuid not null
    references public.inventory_items(id),

  component_item_unit_id uuid not null
    references public.inventory_item_units(id),

  quantity numeric(18,6) not null
    check(quantity > 0),

  waste_percent numeric(7,4)
    not null default 0,

  sort_order integer not null default 0,

  notes text
);

create index recipe_components_recipe_idx
on public.recipe_components(recipe_version_id);

-- Original section 22: Recipe Steps
create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),

  recipe_version_id uuid not null
    references public.recipe_versions(id) on delete cascade,

  step_number integer not null,

  title text,
  instructions text not null,

  media_path text,

  created_at timestamptz not null default now(),

  unique(recipe_version_id, step_number)
);

-- Original section 23: Menu Categories
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  name text not null,

  active boolean not null default true,

  sort_order integer default 0
);

-- Original section 24: Menu Items
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  category_id uuid
    references public.menu_categories(id),

  recipe_id uuid
    references public.recipes(id),

  name text not null,
  internal_name text,

  description text,

  image_path text,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_item_prices (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid
    references public.locations(id),

  menu_item_id uuid not null
    references public.menu_items(id) on delete cascade,

  selling_price numeric(14,2) not null,

  effective_from timestamptz not null default now(),
  effective_to timestamptz
);

-- Original section 25: Modifiers
create table public.modifiers (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  name text not null,

  default_effect_type public.modifier_effect_type
    not null default 'none',

  default_recipe_id uuid
    references public.recipes(id),

  active boolean not null default true,

  created_at timestamptz not null default now()
);

-- Original section 26: Modifier Rules por produto
create table public.menu_item_modifier_rules (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  menu_item_id uuid not null
    references public.menu_items(id) on delete cascade,

  modifier_id uuid not null
    references public.modifiers(id) on delete cascade,

  effect_type public.modifier_effect_type not null,

  inventory_item_id uuid
    references public.inventory_items(id),

  item_unit_id uuid
    references public.inventory_item_units(id),

  quantity numeric(18,6),

  recipe_id uuid
    references public.recipes(id),

  unique(menu_item_id, modifier_id)
);
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recipes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recipes TO service_role;
ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recipe_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recipe_versions TO service_role;
ALTER TABLE public.recipe_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recipe_components FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recipe_components TO service_role;
ALTER TABLE public.recipe_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recipe_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recipe_steps TO service_role;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.menu_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_categories TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.menu_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_items TO service_role;
ALTER TABLE public.menu_item_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.menu_item_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_item_prices TO service_role;
ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.modifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.modifiers TO service_role;
ALTER TABLE public.menu_item_modifier_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.menu_item_modifier_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_item_modifier_rules TO service_role;

;
