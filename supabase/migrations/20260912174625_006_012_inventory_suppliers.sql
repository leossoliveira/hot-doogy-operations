SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
DO $$ DECLARE obj text; BEGIN FOREACH obj IN ARRAY ARRAY['public.inventory_categories','public.inventory_items','public.inventory_item_units','public.location_inventory_items','public.tags','public.inventory_item_tags','public.supplier_categories','public.suppliers','public.supplier_contacts','public.supplier_items'] LOOP IF to_regclass(obj) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing object %, inspect before applying',obj; END IF; END LOOP; END $$;
-- Original section 6: Categorias e Inventory Items
create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  parent_id uuid
    references public.inventory_categories(id) on delete set null,

  name text not null,
  active boolean not null default true,

  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  category_id uuid
    references public.inventory_categories(id) on delete set null,

  name text not null,
  internal_name text,

  item_type public.inventory_item_type not null,

  base_unit_id uuid not null
    references public.units(id),

  track_inventory boolean not null default true,

  description text,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_items_org_idx
on public.inventory_items(organization_id);

create index inventory_items_category_idx
on public.inventory_items(category_id);

-- Original section 7: Unidades específicas de cada item
create table public.inventory_item_units (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id) on delete cascade,

  unit_id uuid not null
    references public.units(id),

  quantity_in_base_unit numeric(18,6) not null
    check (quantity_in_base_unit > 0),

  is_base_unit boolean not null default false,
  is_purchase_unit boolean not null default false,
  is_receive_unit boolean not null default false,
  is_count_unit boolean not null default false,

  display_order integer not null default 0,

  created_at timestamptz not null default now(),

  unique(inventory_item_id, unit_id)
);

-- Original section 8: Configuração do item por loja
create table public.location_inventory_items (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id) on delete cascade,

  default_storage_area_id uuid
    references public.storage_areas(id),

  active boolean not null default true,

  created_at timestamptz not null default now(),

  unique(location_id, inventory_item_id)
);

-- Original section 9: Tags
create table public.tags (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  name text not null,
  color text,

  unique(organization_id, name)
);

create table public.inventory_item_tags (
  inventory_item_id uuid not null
    references public.inventory_items(id) on delete cascade,

  tag_id uuid not null
    references public.tags(id) on delete cascade,

  primary key(inventory_item_id, tag_id)
);

-- Original section 10: Supplier Categories
create table public.supplier_categories (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  name text not null,

  unique(organization_id, name)
);

-- Original section 11: Suppliers
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  category_id uuid
    references public.supplier_categories(id) on delete set null,

  name text not null,

  website_url text,

  default_order_method public.order_method,
  order_url text,

  notes text,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index suppliers_org_idx
on public.suppliers(organization_id);

alter table public.member_supplier_access
add constraint member_supplier_access_supplier_fk
foreign key (supplier_id)
references public.suppliers(id)
on delete cascade;

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),

  supplier_id uuid not null
    references public.suppliers(id) on delete cascade,

  name text,

  email citext,
  phone text,

  is_primary boolean not null default false,

  created_at timestamptz not null default now()
);

-- Original section 12: Supplier Items
create table public.supplier_items (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  supplier_id uuid not null
    references public.suppliers(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id),

  supplier_product_name text not null,

  brand text,
  sku text,

  purchase_item_unit_id uuid
    references public.inventory_item_units(id),

  receive_item_unit_id uuid
    references public.inventory_item_units(id),

  product_url text,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_items_supplier_idx
on public.supplier_items(supplier_id);

create index supplier_items_inventory_idx
on public.supplier_items(inventory_item_id);
ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_categories TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_items TO service_role;
ALTER TABLE public.inventory_item_units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_item_units FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_item_units TO service_role;
ALTER TABLE public.location_inventory_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.location_inventory_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.location_inventory_items TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tags TO service_role;
ALTER TABLE public.inventory_item_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_item_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_item_tags TO service_role;
ALTER TABLE public.supplier_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.supplier_categories TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.suppliers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers TO service_role;
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.supplier_contacts TO service_role;
ALTER TABLE public.supplier_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.supplier_items TO service_role;

;
