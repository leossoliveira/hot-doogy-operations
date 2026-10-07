SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(727002);
-- Original section 49: Updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create trigger inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

create trigger suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();

create trigger supplier_items_updated_at
before update on public.supplier_items
for each row execute function public.set_updated_at();

create trigger purchase_orders_updated_at
before update on public.purchase_orders
for each row execute function public.set_updated_at();

create trigger invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

create trigger recipes_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

create trigger menu_items_updated_at
before update on public.menu_items
for each row execute function public.set_updated_at();

-- Original section 50: RLS: parte crítica no Supabase
create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$

  select exists (

    select 1

    from public.organization_members m

    where
      m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'

  );

$$;

revoke all
on function private.is_org_member(uuid)
from public;

grant usage on schema private to authenticated;

grant execute
on function private.is_org_member(uuid)
to authenticated;

create or replace function private.has_org_role(
  target_org uuid,
  allowed_roles public.member_role[]
)
returns boolean

language sql
security definer
set search_path = ''
stable

as $$

  select exists (

    select 1

    from public.organization_members m

    where
      m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(allowed_roles)

  );

$$;

revoke all
on function private.has_org_role(uuid, public.member_role[])
from public;

grant execute
on function private.has_org_role(uuid, public.member_role[])
to authenticated;

-- Original section 51: Exemplo de RLS em Inventory Items
alter table public.inventory_items
enable row level security;

create policy "members can read inventory items"

on public.inventory_items

for select

to authenticated

using (
  private.is_org_member(organization_id)
);

create policy "management can create inventory items"

on public.inventory_items

for insert

to authenticated

with check (

  private.has_org_role(
    organization_id,
    array[
      'owner',
      'admin',
      'manager',
      'chef'
    ]::public.member_role[]
  )

);

create policy "management can update inventory items"

on public.inventory_items

for update

to authenticated

using (

  private.has_org_role(
    organization_id,
    array[
      'owner',
      'admin',
      'manager',
      'chef'
    ]::public.member_role[]
  )

)

with check (

  private.has_org_role(
    organization_id,
    array[
      'owner',
      'admin',
      'manager',
      'chef'
    ]::public.member_role[]
  )

);

;
