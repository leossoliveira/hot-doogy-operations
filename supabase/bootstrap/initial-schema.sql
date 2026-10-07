-- Recovered initial structure for isolated replay ONLY. Not a production migration.

-- Source: read-only production catalogs, 2026-10-07; no business rows exported.

create schema if not exists private;

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

create extension if not exists citext with schema public;

set search_path=public,extensions;

create type public."member_role" as enum ('owner','admin','manager','chef','employee','viewer');

create type public."member_status" as enum ('invited','active','suspended','inactive');

create type public."inventory_item_type" as enum ('purchased','prepared');

create type public."unit_kind" as enum ('count','mass','volume','package','custom');

create type public."order_method" as enum ('portal','email','sms','link','phone','other');

create type public."purchase_order_status" as enum ('draft','pending_approval','approved','ordered','partially_received','received','completed','cancelled');

create type public."receipt_status" as enum ('draft','receiving','completed','cancelled');

create type public."invoice_status" as enum ('uploaded','processing','review','approved','paid','cancelled');

create type public."price_status" as enum ('pending','approved','rejected');

create type public."recipe_type" as enum ('prep','menu','modifier');

create type public."recipe_status" as enum ('draft','active','archived');

create type public."modifier_effect_type" as enum ('fixed_addition','fixed_removal','context_dependent','none');

create type public."import_type" as enum ('item_sales','modifier_sales','sales_summary','orders','refunds','generic');

create type public."import_status" as enum ('uploaded','validating','ready','processing','completed','completed_with_errors','failed','cancelled');

create type public."data_granularity" as enum ('transaction','hour','day','week','month','period');

create type public."inventory_transaction_type" as enum ('purchase_receipt','sale_consumption','prep_consumption','prep_production','waste','count_adjustment','transfer_in','transfer_out','vendor_return','manual_adjustment');

create type public."stock_count_status" as enum ('draft','in_progress','review','completed','cancelled');

create type public."transfer_status" as enum ('draft','in_transit','completed','cancelled');

create type public."prep_plan_status" as enum ('draft','approved','in_progress','completed','cancelled');

create type public."prep_batch_status" as enum ('planned','in_progress','completed','cancelled');

create type public."action_status" as enum ('pending','approved','executed','rejected','failed');

create type public."costing_method" as enum ('latest_cost','weighted_average');

create table public."departments" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "location_id" uuid,
  "name" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."location_settings" (
  "location_id" uuid not null,
  "organization_id" uuid not null,
  "target_food_cost_food" numeric(7,4) default 0.25,
  "target_food_cost_beverage" numeric(7,4) default 0.20,
  "costing_method" costing_method default 'latest_cost'::costing_method not null,
  "default_safety_stock_pct" numeric(7,4) default 0.10,
  "settings" jsonb default '{}'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."locations" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "name" text not null,
  "code" text,
  "timezone" text default 'America/New_York'::text not null,
  "currency" character(3) default 'USD'::bpchar not null,
  "address_line_1" text,
  "address_line_2" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "country" text default 'US'::text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."member_location_access" (
  "member_id" uuid not null,
  "location_id" uuid not null
);

create table public."member_storage_area_access" (
  "member_id" uuid not null,
  "storage_area_id" uuid not null,
  "can_view" boolean default true not null,
  "can_count" boolean default false not null,
  "can_manage" boolean default false not null
);

create table public."member_supplier_access" (
  "member_id" uuid not null,
  "supplier_id" uuid not null,
  "can_view" boolean default true not null,
  "can_order" boolean default false not null,
  "can_manage" boolean default false not null
);

create table public."organization_members" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "user_id" uuid not null,
  "role" member_role default 'employee'::member_role not null,
  "status" member_status default 'active'::member_status not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."organizations" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "legal_name" text,
  "slug" text not null,
  "currency" character(3) default 'USD'::bpchar not null,
  "timezone" text default 'America/New_York'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."profiles" (
  "id" uuid not null,
  "full_name" text,
  "phone" text,
  "avatar_path" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."storage_areas" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "location_id" uuid not null,
  "department_id" uuid,
  "name" text not null,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."units" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid,
  "code" text not null,
  "name" text not null,
  "symbol" text,
  "kind" unit_kind not null,
  "is_system" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);

alter table public."departments" add constraint "departments_pkey" PRIMARY KEY (id);

alter table public."location_settings" add constraint "location_settings_pkey" PRIMARY KEY (location_id);

alter table public."locations" add constraint "locations_organization_id_code_key" UNIQUE (organization_id, code);

alter table public."locations" add constraint "locations_pkey" PRIMARY KEY (id);

alter table public."member_location_access" add constraint "member_location_access_pkey" PRIMARY KEY (member_id, location_id);

alter table public."member_storage_area_access" add constraint "member_storage_area_access_pkey" PRIMARY KEY (member_id, storage_area_id);

alter table public."member_supplier_access" add constraint "member_supplier_access_pkey" PRIMARY KEY (member_id, supplier_id);

alter table public."organization_members" add constraint "organization_members_organization_id_user_id_key" UNIQUE (organization_id, user_id);

alter table public."organization_members" add constraint "organization_members_pkey" PRIMARY KEY (id);

alter table public."organizations" add constraint "organizations_pkey" PRIMARY KEY (id);

alter table public."organizations" add constraint "organizations_slug_key" UNIQUE (slug);

alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);

alter table public."storage_areas" add constraint "storage_areas_location_id_name_key" UNIQUE (location_id, name);

alter table public."storage_areas" add constraint "storage_areas_pkey" PRIMARY KEY (id);

alter table public."units" add constraint "units_pkey" PRIMARY KEY (id);


alter table public."departments" add constraint "departments_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table public."departments" add constraint "departments_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

alter table public."location_settings" add constraint "location_settings_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table public."location_settings" add constraint "location_settings_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

alter table public."locations" add constraint "locations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

alter table public."member_location_access" add constraint "member_location_access_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table public."member_location_access" add constraint "member_location_access_member_id_fkey" FOREIGN KEY (member_id) REFERENCES organization_members(id) ON DELETE CASCADE;

alter table public."member_storage_area_access" add constraint "member_storage_area_access_member_id_fkey" FOREIGN KEY (member_id) REFERENCES organization_members(id) ON DELETE CASCADE;

alter table public."member_storage_area_access" add constraint "member_storage_area_access_storage_area_id_fkey" FOREIGN KEY (storage_area_id) REFERENCES storage_areas(id) ON DELETE CASCADE;

alter table public."member_supplier_access" add constraint "member_supplier_access_member_id_fkey" FOREIGN KEY (member_id) REFERENCES organization_members(id) ON DELETE CASCADE;

alter table public."organization_members" add constraint "organization_members_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

alter table public."organization_members" add constraint "organization_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."storage_areas" add constraint "storage_areas_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

alter table public."storage_areas" add constraint "storage_areas_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table public."storage_areas" add constraint "storage_areas_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

alter table public."units" add constraint "units_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX locations_org_idx ON public.locations USING btree (organization_id);

CREATE INDEX organization_members_user_idx ON public.organization_members USING btree (user_id);



alter table public."departments" enable row level security;

alter table public."location_settings" enable row level security;

alter table public."locations" enable row level security;

alter table public."member_location_access" enable row level security;

alter table public."member_storage_area_access" enable row level security;

alter table public."member_supplier_access" enable row level security;

alter table public."organization_members" enable row level security;

alter table public."organizations" enable row level security;

alter table public."profiles" enable row level security;

alter table public."storage_areas" enable row level security;

alter table public."units" enable row level security;
