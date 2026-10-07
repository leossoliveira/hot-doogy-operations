SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
DO $$ DECLARE obj text; BEGIN FOREACH obj IN ARRAY ARRAY['public.inventory_transactions','public.inventory_targets','public.stock_counts','public.stock_count_lines','public.stock_count_line_entries','public.waste_events','public.waste_event_lines','public.inventory_transfers','public.inventory_transfer_lines'] LOOP IF to_regclass(obj) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing object %, inspect before applying',obj; END IF; END LOOP; END $$;
-- Original section 34: Inventory Ledger
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  storage_area_id uuid not null
    references public.storage_areas(id),

  inventory_item_id uuid not null
    references public.inventory_items(id),

  transaction_type public.inventory_transaction_type not null,

  quantity_base numeric(18,6) not null,

  unit_cost_base numeric(18,6),

  total_cost numeric(14,2),

  source_type text,
  source_id uuid,

  period_start timestamptz,
  period_end timestamptz,

  granularity public.data_granularity,

  occurred_at timestamptz,

  created_by uuid
    references auth.users(id),

  created_at timestamptz not null default now()
);

create index inventory_tx_item_idx
on public.inventory_transactions
(location_id, inventory_item_id, created_at);

create index inventory_tx_storage_idx
on public.inventory_transactions
(storage_area_id, inventory_item_id);

-- Original section 35: Live Inventory VIEW
create or replace view public.v_live_inventory
with (security_invoker = true)
as

select
  organization_id,
  location_id,
  storage_area_id,
  inventory_item_id,

  sum(quantity_base) as quantity_base

from public.inventory_transactions

group by
  organization_id,
  location_id,
  storage_area_id,
  inventory_item_id;

-- Original section 36: Inventory Targets
create table public.inventory_targets (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  storage_area_id uuid
    references public.storage_areas(id),

  inventory_item_id uuid not null
    references public.inventory_items(id),

  par_level_base numeric(18,6),

  reorder_point_base numeric(18,6),

  safety_stock_base numeric(18,6),

  unique(location_id, storage_area_id, inventory_item_id)
);

-- Original section 37: Stock Counts
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  status public.stock_count_status
    not null default 'draft',

  filter_storage_area_id uuid
    references public.storage_areas(id),

  filter_supplier_id uuid
    references public.suppliers(id),

  started_at timestamptz,
  completed_at timestamptz,

  created_by uuid
    references auth.users(id),

  completed_by uuid
    references auth.users(id),

  notes text,

  created_at timestamptz not null default now()
);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  stock_count_id uuid not null
    references public.stock_counts(id) on delete cascade,

  storage_area_id uuid not null
    references public.storage_areas(id),

  inventory_item_id uuid not null
    references public.inventory_items(id),

  expected_base_quantity numeric(18,6),

  counted_base_quantity numeric(18,6),

  variance_base_quantity numeric(18,6),

  notes text,

  unique(stock_count_id, storage_area_id, inventory_item_id)
);

-- Original section 38: As múltiplas unidades no Stock Count
create table public.stock_count_line_entries (
  id uuid primary key default gen_random_uuid(),

  stock_count_line_id uuid not null
    references public.stock_count_lines(id) on delete cascade,

  inventory_item_unit_id uuid not null
    references public.inventory_item_units(id),

  quantity numeric(18,6) not null default 0,

  unique(stock_count_line_id, inventory_item_unit_id)
);

-- Original section 39: Waste
create table public.waste_events (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  occurred_at timestamptz not null default now(),

  reason text,

  reported_by uuid
    references auth.users(id),

  notes text,

  created_at timestamptz not null default now()
);

create table public.waste_event_lines (
  id uuid primary key default gen_random_uuid(),

  waste_event_id uuid not null
    references public.waste_events(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id),

  storage_area_id uuid not null
    references public.storage_areas(id),

  inventory_item_unit_id uuid
    references public.inventory_item_units(id),

  quantity numeric(18,6) not null,

  quantity_base numeric(18,6) not null,

  estimated_cost numeric(14,2)
);

-- Original section 40: Inventory Transfers
create table public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  status public.transfer_status
    not null default 'draft',

  from_storage_area_id uuid not null
    references public.storage_areas(id),

  to_storage_area_id uuid not null
    references public.storage_areas(id),

  transferred_at timestamptz,

  created_by uuid
    references auth.users(id),

  notes text,

  created_at timestamptz not null default now()
);

create table public.inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),

  transfer_id uuid not null
    references public.inventory_transfers(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id),

  quantity_base numeric(18,6) not null
    check(quantity_base > 0)
);
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_transactions TO service_role;
ALTER TABLE public.inventory_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_targets TO service_role;
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_counts TO service_role;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_count_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_count_lines TO service_role;
ALTER TABLE public.stock_count_line_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_count_line_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_count_line_entries TO service_role;
ALTER TABLE public.waste_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.waste_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.waste_events TO service_role;
ALTER TABLE public.waste_event_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.waste_event_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.waste_event_lines TO service_role;
ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_transfers TO service_role;
ALTER TABLE public.inventory_transfer_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_transfer_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_transfer_lines TO service_role;
REVOKE ALL ON public.v_live_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_live_inventory TO service_role;

;
