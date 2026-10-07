
create table if not exists public.purchase_order_tags (
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (purchase_order_id, tag_id)
);

alter table public.purchase_order_tags enable row level security;
revoke all on public.purchase_order_tags from public, anon, authenticated;
grant select on public.purchase_order_tags to authenticated;
grant select, insert, update, delete on public.purchase_order_tags to service_role;

drop policy if exists purchase_order_tags_select_manager on public.purchase_order_tags;
create policy purchase_order_tags_select_manager
on public.purchase_order_tags
for select to authenticated
using (
  exists (
    select 1
    from public.purchase_orders po
    where po.id = purchase_order_tags.purchase_order_id
      and private.is_org_member(po.organization_id)
      and private.can_location(po.location_id)
      and private.can_supplier(po.supplier_id)
      and private.has_org_role(po.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create index if not exists purchase_order_tags_tag_id_idx
on public.purchase_order_tags(tag_id);

create index if not exists purchase_order_tags_purchase_order_id_idx
on public.purchase_order_tags(purchase_order_id);

create or replace function private.create_order_from_unlinked_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_tag_id uuid;
begin
  if new.purchase_order_id is not null or new.receipt_id is not null then
    return new;
  end if;

  insert into public.purchase_orders (
    organization_id,
    location_id,
    supplier_id,
    status,
    order_number,
    ordered_at,
    notes,
    estimated_total,
    created_by
  )
  values (
    new.organization_id,
    new.location_id,
    new.supplier_id,
    'ordered'::public.purchase_order_status,
    'INV-' || coalesce(nullif(btrim(new.invoice_number), ''), replace(new.id::text, '-', '')),
    coalesce(new.invoice_date::timestamptz, now()),
    'Created automatically from invoice' || case when nullif(btrim(new.invoice_number), '') is null then '' else ': ' || new.invoice_number end,
    new.total,
    new.created_by
  )
  returning id into v_order_id;

  select id
  into v_tag_id
  from public.tags
  where organization_id = new.organization_id
    and lower(name) = 'from invoice'
  order by id
  limit 1;

  if v_tag_id is null then
    insert into public.tags (organization_id, name, color)
    values (new.organization_id, 'From Invoice', '#64748B')
    returning id into v_tag_id;
  end if;

  insert into public.purchase_order_tags (purchase_order_id, tag_id)
  values (v_order_id, v_tag_id)
  on conflict do nothing;

  update public.invoices
  set purchase_order_id = v_order_id
  where id = new.id
    and purchase_order_id is null
    and receipt_id is null;

  return new;
end;
$$;

revoke all on function private.create_order_from_unlinked_invoice() from public;

drop trigger if exists invoices_create_order_from_unlinked_invoice on public.invoices;
create trigger invoices_create_order_from_unlinked_invoice
after insert on public.invoices
for each row
execute function private.create_order_from_unlinked_invoice();

;
