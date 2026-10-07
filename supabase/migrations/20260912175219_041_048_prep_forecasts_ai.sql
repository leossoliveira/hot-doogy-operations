SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
DO $$ DECLARE obj text; BEGIN FOREACH obj IN ARRAY ARRAY['public.prep_plans','public.prep_plan_items','public.prep_batches','public.prep_batch_components','public.menu_item_forecasts','public.ai_conversations','public.ai_messages','public.ai_actions','public.audit_logs'] LOOP IF to_regclass(obj) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing object %, inspect before applying',obj; END IF; END LOOP; END $$;
-- Original section 41: Prep Planning
create table public.prep_plans (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  period_start timestamptz not null,
  period_end timestamptz not null,

  status public.prep_plan_status
    not null default 'draft',

  created_by uuid
    references auth.users(id),

  approved_by uuid
    references auth.users(id),

  created_at timestamptz not null default now()
);

-- Original section 42: Prep Plan Items
create table public.prep_plan_items (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  prep_plan_id uuid not null
    references public.prep_plans(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id),

  recipe_version_id uuid
    references public.recipe_versions(id),

  current_stock_base numeric(18,6),

  forecast_demand_base numeric(18,6),

  safety_stock_base numeric(18,6),

  suggested_output_base numeric(18,6),

  suggested_batches numeric(18,4),

  approved_output_base numeric(18,6),

  department_id uuid
    references public.departments(id),

  assigned_to uuid
    references auth.users(id),

  notes text
);

-- Original section 43: Prep Batches
create table public.prep_batches (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  prep_plan_item_id uuid
    references public.prep_plan_items(id),

  recipe_version_id uuid not null
    references public.recipe_versions(id),

  output_inventory_item_id uuid not null
    references public.inventory_items(id),

  output_storage_area_id uuid not null
    references public.storage_areas(id),

  status public.prep_batch_status
    not null default 'planned',

  planned_output_base numeric(18,6),

  actual_output_base numeric(18,6),

  started_at timestamptz,
  completed_at timestamptz,

  prepared_by uuid
    references auth.users(id),

  notes text,

  created_at timestamptz not null default now()
);

-- Original section 44: Consumo real da preparação
create table public.prep_batch_components (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  prep_batch_id uuid not null
    references public.prep_batches(id) on delete cascade,

  inventory_item_id uuid not null
    references public.inventory_items(id),

  storage_area_id uuid not null
    references public.storage_areas(id),

  planned_quantity_base numeric(18,6),

  actual_quantity_base numeric(18,6)
);

-- Original section 45: Forecast de vendas
create table public.menu_item_forecasts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid not null
    references public.locations(id),

  menu_item_id uuid not null
    references public.menu_items(id),

  period_start timestamptz not null,
  period_end timestamptz not null,

  forecast_quantity numeric(18,6) not null,

  model_name text,

  confidence numeric(7,4),

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- Original section 46: AI Agent
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  location_id uuid
    references public.locations(id),

  user_id uuid
    references auth.users(id),

  channel text not null,

  external_conversation_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.ai_conversations(id) on delete cascade,

  role text not null
    check(role in ('user','assistant','system','tool')),

  content text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  conversation_id uuid
    references public.ai_conversations(id),

  requested_by uuid
    references auth.users(id),

  action_type text not null,

  action_payload jsonb not null,

  status public.action_status
    not null default 'pending',

  executed_at timestamptz,

  result jsonb,

  created_at timestamptz not null default now()
);

-- Original section 47: Audit Log
create table public.audit_logs (
  id bigint generated always as identity primary key,

  organization_id uuid
    references public.organizations(id) on delete cascade,

  location_id uuid
    references public.locations(id),

  user_id uuid
    references auth.users(id),

  action text not null,

  entity_type text not null,
  entity_id uuid,

  old_data jsonb,
  new_data jsonb,

  ip_address inet,

  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx
on public.audit_logs(entity_type, entity_id);

create index audit_logs_org_date_idx
on public.audit_logs(organization_id, created_at desc);

-- Original section 48: View de preço atual
create or replace view public.v_current_supplier_prices
with (security_invoker = true)
as

select distinct on (supplier_item_id, location_id)

  supplier_item_id,
  location_id,

  price_per_purchase_unit,

  effective_at

from public.supplier_item_price_history

where status = 'approved'

order by
  supplier_item_id,
  location_id,
  effective_at desc;
ALTER TABLE public.prep_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prep_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prep_plans TO service_role;
ALTER TABLE public.prep_plan_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prep_plan_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prep_plan_items TO service_role;
ALTER TABLE public.prep_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prep_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prep_batches TO service_role;
ALTER TABLE public.prep_batch_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prep_batch_components FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prep_batch_components TO service_role;
ALTER TABLE public.menu_item_forecasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.menu_item_forecasts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_item_forecasts TO service_role;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_conversations TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_messages TO service_role;
ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_actions TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO service_role;
REVOKE ALL ON public.v_current_supplier_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_current_supplier_prices TO service_role;

;
