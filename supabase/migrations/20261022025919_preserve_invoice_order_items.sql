-- Keep the invoice's itemization even when catalog matching is unavailable.
alter table public.purchase_order_lines
 add column source_invoice_line_id uuid unique references public.invoice_lines(id) on delete set null,
 add column description text,
 add column source_unit text,
 add column source_sku text,
 alter column inventory_item_id drop not null,
 alter column ordered_purchase_qty drop not null;
alter table public.purchase_order_lines add constraint order_line_product_or_description
 check (inventory_item_id is not null or nullif(btrim(description),'') is not null);

create function private.guard_invoice_order_source() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.source_invoice_line_id is not null and not exists(
  select 1 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  join public.purchase_orders p on p.id=i.purchase_order_id
  where l.id=new.source_invoice_line_id and l.organization_id=new.organization_id
   and i.organization_id=new.organization_id and p.organization_id=new.organization_id
   and p.id=new.purchase_order_id and p.supplier_id=i.supplier_id and p.location_id=i.location_id
 ) then raise exception 'Invoice line must belong to the same order and organization';end if;
 return new;
end $$;
revoke all on function private.guard_invoice_order_source() from public,anon,authenticated,service_role;
create trigger order_invoice_source_guard before insert or update on public.purchase_order_lines
for each row execute function private.guard_invoice_order_source();

create function private.guard_unmatched_order_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.purchase_order_lines l where l.id=new.purchase_order_line_id
  and l.source_invoice_line_id is not null and (l.inventory_item_id is null or l.purchase_item_unit_id is null
   or l.ordered_purchase_qty is null or l.ordered_purchase_qty<=0)) then
  raise exception 'Match the invoice product and unit before receiving goods';
 end if;
 return new;
end $$;
revoke all on function private.guard_unmatched_order_receipt() from public,anon,authenticated,service_role;
create trigger order_unmatched_receipt_guard before insert or update on public.purchase_receipt_lines
for each row execute function private.guard_unmatched_order_receipt();

-- The existing RPCs retain their authorization, approval and document guards.
-- Remove their lossy second insertion path; the line trigger below is canonical.
do $patch$
declare target regprocedure; definition text; replacement text; start_at integer; block_length integer;
begin
 foreach target in array array[
  'private.create_order_from_unlinked_invoice()'::regprocedure,
  'public.save_llm_invoice_draft(uuid,jsonb)'::regprocedure,
  'public.edit_llm_invoice_draft(uuid,timestamptz,jsonb)'::regprocedure,
  'public.approve_llm_invoice_draft(uuid,timestamptz,text)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  replacement:=replace(replace(definition,'''INV-'' || ',''),'''INV-''||','');
  if target in ('public.save_llm_invoice_draft(uuid,jsonb)'::regprocedure,'public.edit_llm_invoice_draft(uuid,timestamptz,jsonb)'::regprocedure) then
   if position('if generated and item is not null and unit is not null' in replacement)=0 then
    raise exception 'Unexpected invoice order insertion implementation: %',target;
   end if;
   start_at:=position('if generated and item is not null and unit is not null' in replacement);
   block_length:=position('end if;' in substring(replacement from start_at))+length('end if;')-1;
   replacement:=overlay(replacement placing '' from start_at for block_length);
   if position('if generated and item is not null and unit is not null' in replacement)>0 then raise exception 'Invoice insertion patch failed';end if;
  end if;
  execute replacement;
 end loop;
end $patch$;

create function private.match_invoice_order_item() returns trigger
language plpgsql security invoker set search_path='' as $$
declare vendor uuid; matches integer; candidate uuid; item uuid; chosen uuid; factor numeric;
begin
 select supplier_id into vendor from public.invoices where id=new.invoice_id and organization_id=new.organization_id;
 if vendor is null then return new;end if;
 -- An absent SKU may use an exact, unique supplier description, never fuzzy matching.
 if new.inventory_item_id is null and new.supplier_item_id is null then
  select count(*),(array_agg(s.id))[1],(array_agg(s.inventory_item_id))[1]
  into matches,candidate,item from public.supplier_items s
  where s.organization_id=new.organization_id and s.supplier_id=vendor and s.active
   and case when nullif(btrim(new.sku),'') is not null then lower(btrim(s.sku))=lower(btrim(new.sku))
    else lower(btrim(s.supplier_product_name))=lower(btrim(new.description)) end;
  if matches=1 then new.supplier_item_id:=candidate;new.inventory_item_id:=item;end if;
 end if;
 if new.inventory_item_id is not null and new.item_unit_id is null and nullif(btrim(new.source_unit),'') is not null then
  select count(*),(array_agg(iu.id))[1],(array_agg(iu.quantity_in_base_unit))[1]
  into matches,chosen,factor from public.inventory_item_units iu join public.units u on u.id=iu.unit_id
  where iu.organization_id=new.organization_id and iu.inventory_item_id=new.inventory_item_id
   and lower(btrim(new.source_unit)) in (lower(u.name),lower(u.code),lower(u.symbol));
  if matches=1 then new.item_unit_id:=chosen;new.quantity_base:=new.quantity*factor;end if;
 end if;
 return new;
end $$;
revoke all on function private.match_invoice_order_item() from public,anon,authenticated,service_role;
create trigger invoice_order_item_match before insert or update on public.invoice_lines
for each row execute function private.match_invoice_order_item();

create function private.sync_invoice_order_item() returns trigger
language plpgsql security invoker set search_path='' as $$
declare ord public.purchase_orders%rowtype; inv public.invoices%rowtype;
begin
 select * into inv from public.invoices where id=new.invoice_id and organization_id=new.organization_id;
 select p.* into ord from public.purchase_orders p where p.id=inv.purchase_order_id
  and p.organization_id=inv.organization_id and p.location_id=inv.location_id and p.supplier_id=inv.supplier_id
  and p.status<>'cancelled' and exists(select 1 from public.purchase_order_tags pt join public.tags t on t.id=pt.tag_id
   where pt.purchase_order_id=p.id and t.organization_id=p.organization_id and lower(t.name)='from invoice');
 if ord.id is null then return new;end if;
 insert into public.purchase_order_lines(organization_id,purchase_order_id,source_invoice_line_id,
  supplier_item_id,inventory_item_id,purchase_item_unit_id,description,source_unit,source_sku,
  ordered_purchase_qty,estimated_unit_price,line_total)
 values(new.organization_id,ord.id,new.id,new.supplier_item_id,new.inventory_item_id,new.item_unit_id,
  new.description,new.source_unit,new.sku,new.quantity,new.unit_price,new.line_total)
 on conflict(source_invoice_line_id) do update set
  supplier_item_id=excluded.supplier_item_id,inventory_item_id=excluded.inventory_item_id,
  purchase_item_unit_id=excluded.purchase_item_unit_id,description=excluded.description,
  source_unit=excluded.source_unit,source_sku=excluded.source_sku,
  ordered_purchase_qty=excluded.ordered_purchase_qty,estimated_unit_price=excluded.estimated_unit_price,line_total=excluded.line_total;
 return new;
end $$;
revoke all on function private.sync_invoice_order_item() from public,anon,authenticated,service_role;
create trigger invoice_order_item_sync after insert or update on public.invoice_lines
for each row execute function private.sync_invoice_order_item();

-- Adopt existing matching lines one-to-one before backfill, preserving receipt links.
do $repair$
declare l record; existing uuid;
begin
 for l in select il.*,i.purchase_order_id from public.invoice_lines il join public.invoices i on i.id=il.invoice_id
 join public.purchase_orders p on p.id=i.purchase_order_id and p.organization_id=i.organization_id
  and p.location_id=i.location_id and p.supplier_id=i.supplier_id
 where p.status<>'cancelled' and exists(select 1 from public.purchase_order_tags pt join public.tags t on t.id=pt.tag_id
  where pt.purchase_order_id=p.id and t.organization_id=p.organization_id and lower(t.name)='from invoice')
 order by il.id loop
  select id into existing from public.purchase_order_lines ol where ol.purchase_order_id=l.purchase_order_id
   and ol.source_invoice_line_id is null and ol.inventory_item_id is not distinct from l.inventory_item_id
   and ol.purchase_item_unit_id is not distinct from l.item_unit_id and ol.ordered_purchase_qty is not distinct from l.quantity
   and ol.estimated_unit_price is not distinct from l.unit_price and ol.line_total is not distinct from l.line_total
   order by ol.id limit 1;
  if existing is not null then
   update public.purchase_order_lines set source_invoice_line_id=l.id,description=l.description,
    source_unit=l.source_unit,source_sku=l.sku where id=existing;
  end if;
  -- Executes the same matching/sync path used by future saves.
  update public.invoice_lines set description=description where id=l.id;
 end loop;
end $repair$;

update public.purchase_orders p set order_number=substring(order_number from 5)
where order_number like 'INV-%' and exists(select 1 from public.purchase_order_tags pt join public.tags t on t.id=pt.tag_id
 where pt.purchase_order_id=p.id and t.organization_id=p.organization_id and lower(t.name)='from invoice');
