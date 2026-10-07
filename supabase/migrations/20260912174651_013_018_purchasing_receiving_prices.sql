SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
DO $$ DECLARE obj text; BEGIN FOREACH obj IN ARRAY ARRAY['public.purchase_orders','public.purchase_order_lines','public.purchase_order_stock_entries','public.purchase_receipts','public.purchase_receipt_lines','public.invoices','public.invoice_documents','public.invoice_lines','public.supplier_item_price_history','public.inventory_item_cost_history'] LOOP IF to_regclass(obj) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing object %, inspect before applying',obj; END IF; END LOOP; END $$;
-- Original section 13: Purchase Orders
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  supplier_id uuid not null
    references public.suppliers(id),

  status public.purchase_order_status
    not null default 'draft',

  order_number text,

  expected_receive_at timestamptz,
  ordered_at timestamptz,

  notes text,

  estimated_total numeric(14,2),

  created_by uuid
    references auth.users(id),

  approved_by uuid
    references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  purchase_order_id uuid not null
    references public.purchase_orders(id) on delete cascade,

  supplier_item_id uuid
    references public.supplier_items(id),

  inventory_item_id uuid not null
    references public.inventory_items(id),

  purchase_item_unit_id uuid
    references public.inventory_item_units(id),

  current_stock_base_qty numeric(18,6),

  suggested_purchase_qty numeric(18,6),

  ordered_purchase_qty numeric(18,6) not null default 0,

  estimated_unit_price numeric(14,4),

  line_total numeric(14,2),

  notes text
);

-- Original section 14: Stock Check antes da ordem
create table public.purchase_order_stock_entries (
  id uuid primary key default gen_random_uuid(),

  purchase_order_line_id uuid not null
    references public.purchase_order_lines(id) on delete cascade,

  inventory_item_unit_id uuid not null
    references public.inventory_item_units(id),

  quantity numeric(18,6) not null default 0
);

-- Original section 15: Receiving
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  supplier_id uuid not null
    references public.suppliers(id),

  purchase_order_id uuid
    references public.purchase_orders(id),

  status public.receipt_status
    not null default 'draft',

  received_at timestamptz,

  received_by uuid
    references auth.users(id),

  notes text,

  created_at timestamptz not null default now()
);

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  receipt_id uuid not null
    references public.purchase_receipts(id) on delete cascade,

  purchase_order_line_id uuid
    references public.purchase_order_lines(id),

  supplier_item_id uuid
    references public.supplier_items(id),

  inventory_item_id uuid not null
    references public.inventory_items(id),

  storage_area_id uuid not null
    references public.storage_areas(id),

  received_item_unit_id uuid
    references public.inventory_item_units(id),

  quantity_received numeric(18,6) not null,

  quantity_base numeric(18,6) not null,

  unit_cost numeric(14,4),

  line_total numeric(14,2)
);

-- Original section 16: Invoices
create table public.invoices (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  supplier_id uuid not null
    references public.suppliers(id),

  purchase_order_id uuid
    references public.purchase_orders(id),

  receipt_id uuid
    references public.purchase_receipts(id),

  invoice_number text,

  invoice_date date,
  due_date date,

  status public.invoice_status
    not null default 'uploaded',

  subtotal numeric(14,2),
  tax numeric(14,2),
  fees numeric(14,2),
  total numeric(14,2),

  currency char(3) default 'USD',

  notes text,

  created_by uuid
    references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_documents (
  id uuid primary key default gen_random_uuid(),

  invoice_id uuid not null
    references public.invoices(id) on delete cascade,

  storage_path text not null,

  file_name text,
  mime_type text,

  sort_order integer default 0,

  created_at timestamptz not null default now()
);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  invoice_id uuid not null
    references public.invoices(id) on delete cascade,

  supplier_item_id uuid
    references public.supplier_items(id),

  inventory_item_id uuid
    references public.inventory_items(id),

  description text not null,

  sku text,

  item_unit_id uuid
    references public.inventory_item_units(id),

  quantity numeric(18,6),

  quantity_base numeric(18,6),

  unit_price numeric(14,4),

  line_total numeric(14,2),

  created_at timestamptz not null default now()
);

-- Original section 17: Histórico de preços
create table public.supplier_item_price_history (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid
    references public.locations(id),

  supplier_item_id uuid not null
    references public.supplier_items(id) on delete cascade,

  invoice_line_id uuid
    references public.invoice_lines(id) on delete set null,

  price_per_purchase_unit numeric(14,4) not null,

  status public.price_status
    not null default 'pending',

  effective_at timestamptz not null default now(),

  reviewed_by uuid
    references auth.users(id),

  reviewed_at timestamptz,

  created_at timestamptz not null default now()
);

create index supplier_price_history_item_idx
on public.supplier_item_price_history
(supplier_item_id, effective_at desc);

-- Original section 18: Custo do Inventory Item
create table public.inventory_item_cost_history (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid
    references public.locations(id),

  inventory_item_id uuid not null
    references public.inventory_items(id) on delete cascade,

  cost_per_base_unit numeric(18,6) not null,

  source_type text,
  source_id uuid,

  effective_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

create index item_cost_history_idx
on public.inventory_item_cost_history
(inventory_item_id, effective_at desc);
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_orders TO service_role;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_order_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_order_lines TO service_role;
ALTER TABLE public.purchase_order_stock_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_order_stock_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_order_stock_entries TO service_role;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_receipts TO service_role;
ALTER TABLE public.purchase_receipt_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_receipt_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_receipt_lines TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO service_role;
ALTER TABLE public.invoice_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_documents TO service_role;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_lines TO service_role;
ALTER TABLE public.supplier_item_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_item_price_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.supplier_item_price_history TO service_role;
ALTER TABLE public.inventory_item_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_item_cost_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_item_cost_history TO service_role;

;
