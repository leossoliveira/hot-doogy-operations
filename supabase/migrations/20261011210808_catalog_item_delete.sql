-- Delete only unused catalog items. All operational/history references block deletion,
-- including foreign keys configured with CASCADE or SET NULL.
create function private.delete_catalog_item(p_id uuid,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org uuid := '6013ed02-626a-497c-b951-619069035532';
 row public.supplier_items%rowtype; ref record; linked boolean; ids uuid[]; unit_ids uuid[];
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then
  raise exception 'You do not have permission to delete catalog items.' using errcode='42501';
 end if;
 if p_confirmed is distinct from true then raise exception 'Confirm permanent deletion.';end if;
 select * into row from public.supplier_items where id=p_id and organization_id=org for update;
 if not found or not private.can_supplier(row.supplier_id) then raise exception 'Item unavailable.';end if;
 perform 1 from public.inventory_items where id=row.inventory_item_id and organization_id=org for update;
 if not found then raise exception 'Item unavailable.';end if;
 if exists(select 1 from public.supplier_items where inventory_item_id=row.inventory_item_id and id<>p_id) then
  raise exception 'This item is shared with another supplier. Deactivate it instead.';
 end if;
 if exists(select 1 from public.location_inventory_items where inventory_item_id=row.inventory_item_id and not private.can_location(location_id)) then
  raise exception 'You do not have access to every location for this item.' using errcode='42501';
 end if;
 perform 1 from public.inventory_item_units where inventory_item_id=row.inventory_item_id for update;
 select coalesce(array_agg(id),'{}'::uuid[]) into unit_ids from public.inventory_item_units where inventory_item_id=row.inventory_item_id;
 for ref in
  select c.confrelid,c.conrelid,n.nspname,t.relname,a.attname
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t on t.oid=c.conrelid
  join pg_catalog.pg_namespace n on n.oid=t.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid in ('public.inventory_items'::regclass,'public.inventory_item_units'::regclass,'public.supplier_items'::regclass)
 loop
  -- These tables contain only catalog configuration, removed explicitly below.
  if ref.confrelid='public.inventory_items'::regclass and ref.conrelid in ('public.inventory_item_units'::regclass,'public.supplier_items'::regclass,'public.location_inventory_items'::regclass,'public.inventory_item_storage_areas'::regclass,'public.inventory_item_tags'::regclass) then continue;end if;
  if ref.confrelid='public.inventory_item_units'::regclass and ref.conrelid='public.supplier_items'::regclass then continue;end if;
  ids:=case when ref.confrelid='public.inventory_item_units'::regclass then unit_ids when ref.confrelid='public.supplier_items'::regclass then array[p_id] else array[row.inventory_item_id] end;
  execute format('select exists(select 1 from %I.%I where %I = any($1))',ref.nspname,ref.relname,ref.attname) into linked using ids;
  if linked then raise exception 'This item has linked recipes or history. Deactivate it instead.';end if;
 end loop;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,old_data)
 values(org,auth.uid(),'delete','inventory_item',row.inventory_item_id,to_jsonb(row));
 delete from public.supplier_items where id=p_id;
 delete from public.inventory_item_storage_areas where inventory_item_id=row.inventory_item_id;
 delete from public.inventory_item_tags where inventory_item_id=row.inventory_item_id;
 delete from public.location_inventory_items where inventory_item_id=row.inventory_item_id;
 delete from public.inventory_item_units where inventory_item_id=row.inventory_item_id;
 delete from public.inventory_items where id=row.inventory_item_id;
 return jsonb_build_object('deleted',true,'itemId',row.inventory_item_id);
end $$;
revoke all on function private.delete_catalog_item(uuid,boolean) from public,anon,authenticated;
grant execute on function private.delete_catalog_item(uuid,boolean) to authenticated;
create function public.delete_catalog_item(p_id uuid,p_confirmed boolean) returns jsonb
language sql security invoker set search_path='' as $$select private.delete_catalog_item(p_id,p_confirmed)$$;
revoke all on function public.delete_catalog_item(uuid,boolean) from public,anon;
grant execute on function public.delete_catalog_item(uuid,boolean) to authenticated;
-- Rollback: drop public.delete_catalog_item(uuid,boolean), then private counterpart.
