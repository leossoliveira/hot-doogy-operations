SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
DO $$ DECLARE obj text; BEGIN FOREACH obj IN ARRAY ARRAY['public.pos_item_mappings','public.pos_modifier_mappings','public.sales_import_batches','public.sales_import_rows','public.sales_item_facts','public.sales_modifier_facts','public.sales_summary_facts','public.sales_orders','public.sales_order_items','public.sales_order_modifiers'] LOOP IF to_regclass(obj) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing object %, inspect before applying',obj; END IF; END LOOP; END $$;
-- Original section 27: POS Mapping
create table public.pos_item_mappings (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id) on delete cascade,

  pos_source text not null default 'square',

  external_item_id text,
  external_item_name text not null,

  menu_item_id uuid
    references public.menu_items(id),

  active boolean not null default true,

  created_at timestamptz not null default now()
);

create table public.pos_modifier_mappings (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id) on delete cascade,

  pos_source text not null default 'square',

  external_modifier_id text,
  external_modifier_name text not null,

  modifier_id uuid
    references public.modifiers(id),

  active boolean not null default true,

  created_at timestamptz not null default now()
);

-- Original section 28: Sales Import Batches
create table public.sales_import_batches (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id) on delete cascade,

  pos_source text not null default 'square',

  import_type public.import_type not null,

  granularity public.data_granularity not null,

  period_start timestamptz not null,
  period_end timestamptz not null,

  file_name text,
  raw_file_path text,

  file_hash text,

  status public.import_status
    not null default 'uploaded',

  total_rows integer default 0,
  processed_rows integer default 0,
  error_rows integer default 0,

  uploaded_by uuid
    references auth.users(id),

  created_at timestamptz not null default now(),
  processed_at timestamptz,

  unique(location_id, import_type, file_hash)
);

-- Original section 29: Raw Import Rows
create table public.sales_import_rows (
  id uuid primary key default gen_random_uuid(),

  batch_id uuid not null
    references public.sales_import_batches(id) on delete cascade,

  row_number integer not null,

  raw_data jsonb not null,

  normalized_data jsonb,

  error_message text,

  processed boolean not null default false,

  created_at timestamptz not null default now(),

  unique(batch_id, row_number)
);

-- Original section 30: Item Sales Facts
create table public.sales_item_facts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  import_batch_id uuid not null
    references public.sales_import_batches(id) on delete cascade,

  menu_item_id uuid
    references public.menu_items(id),

  external_item_id text,
  external_item_name text not null,

  fact_date date,

  period_start timestamptz not null,
  period_end timestamptz not null,

  granularity public.data_granularity not null,

  quantity numeric(18,6) not null default 0,

  gross_sales numeric(14,2),
  discounts numeric(14,2),
  refunds numeric(14,2),
  net_sales numeric(14,2),

  dimensions jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index sales_item_facts_date_idx
on public.sales_item_facts(location_id, fact_date);

create index sales_item_facts_item_idx
on public.sales_item_facts(menu_item_id);

-- Original section 31: Modifier Sales Facts
create table public.sales_modifier_facts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  import_batch_id uuid not null
    references public.sales_import_batches(id) on delete cascade,

  modifier_id uuid
    references public.modifiers(id),

  parent_menu_item_id uuid
    references public.menu_items(id),

  external_modifier_id text,
  external_modifier_name text not null,

  fact_date date,

  period_start timestamptz not null,
  period_end timestamptz not null,

  granularity public.data_granularity not null,

  quantity numeric(18,6) not null,

  dimensions jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- Original section 32: Sales Summary Facts
create table public.sales_summary_facts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  import_batch_id uuid
    references public.sales_import_batches(id),

  period_start timestamptz not null,
  period_end timestamptz not null,

  granularity public.data_granularity not null,

  orders_count integer,
  items_count numeric(18,6),

  gross_sales numeric(14,2),
  discounts numeric(14,2),
  refunds numeric(14,2),
  net_sales numeric(14,2),

  taxes numeric(14,2),
  tips numeric(14,2),

  avg_ticket numeric(14,2),

  avg_prep_time_seconds numeric(14,2),

  dimension_type text,
  dimension_value text,

  dimensions jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- Original section 33: Estrutura futura para orders reais
create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  import_batch_id uuid
    references public.sales_import_batches(id),

  pos_source text,

  external_order_id text,

  ordered_at timestamptz,
  completed_at timestamptz,

  order_type text,

  gross_sales numeric(14,2),
  discounts numeric(14,2),
  refunds numeric(14,2),
  net_sales numeric(14,2),
  taxes numeric(14,2),
  total numeric(14,2),

  prep_time_seconds integer,

  created_at timestamptz not null default now(),

  unique(location_id, pos_source, external_order_id)
);

create table public.sales_order_items (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  sales_order_id uuid not null
    references public.sales_orders(id) on delete cascade,

  menu_item_id uuid
    references public.menu_items(id),

  external_line_id text,

  item_name_snapshot text not null,

  quantity numeric(18,6) not null,

  gross_sales numeric(14,2),
  net_sales numeric(14,2)
);

create table public.sales_order_modifiers (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  sales_order_item_id uuid not null
    references public.sales_order_items(id) on delete cascade,

  modifier_id uuid
    references public.modifiers(id),

  external_modifier_name text,

  quantity numeric(18,6) not null default 1,

  amount numeric(14,2)
);
ALTER TABLE public.pos_item_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_item_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pos_item_mappings TO service_role;
ALTER TABLE public.pos_modifier_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_modifier_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pos_modifier_mappings TO service_role;
ALTER TABLE public.sales_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_import_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_import_batches TO service_role;
ALTER TABLE public.sales_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_import_rows TO service_role;
ALTER TABLE public.sales_item_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_item_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_item_facts TO service_role;
ALTER TABLE public.sales_modifier_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_modifier_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_modifier_facts TO service_role;
ALTER TABLE public.sales_summary_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_summary_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_summary_facts TO service_role;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_orders TO service_role;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_order_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_order_items TO service_role;
ALTER TABLE public.sales_order_modifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_order_modifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_order_modifiers TO service_role;

;
