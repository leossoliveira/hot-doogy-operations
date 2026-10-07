
create unique index if not exists pos_item_mappings_active_name_key
on public.pos_item_mappings (
  organization_id, location_id, pos_source, lower(external_item_name)
)
where active;

create unique index if not exists pos_item_mappings_active_external_id_key
on public.pos_item_mappings (
  organization_id, location_id, pos_source, external_item_id
)
where active and external_item_id is not null;

create policy pos_item_mappings_insert_manager
on public.pos_item_mappings for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  and pos_source = 'square_csv'
);

create policy pos_item_mappings_update_manager
on public.pos_item_mappings for update to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  and pos_source = 'square_csv'
)
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  and pos_source = 'square_csv'
);

grant select, insert, update on public.pos_item_mappings to authenticated;

drop policy if exists sales_imports_select_manager on storage.objects;
drop policy if exists sales_imports_insert_manager on storage.objects;
drop policy if exists sales_imports_update_manager on storage.objects;
drop policy if exists sales_imports_delete_manager on storage.objects;

create policy sales_imports_select_manager
on storage.objects for select to authenticated
using (
  bucket_id = 'sales-imports'
  and exists (
    select 1
    from public.sales_import_batches b
    where b.organization_id::text = (storage.foldername(name))[1]
      and b.id::text = (storage.foldername(name))[2]
      and private.is_org_member(b.organization_id)
      and private.can_location(b.location_id)
      and private.has_org_role(b.organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

create policy sales_imports_insert_manager
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sales-imports'
  and lower(storage.extension(name)) = 'csv'
  and exists (
    select 1
    from public.sales_import_batches b
    where b.organization_id::text = (storage.foldername(name))[1]
      and b.id::text = (storage.foldername(name))[2]
      and private.is_org_member(b.organization_id)
      and private.can_location(b.location_id)
      and private.has_org_role(b.organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

create policy sales_imports_update_manager
on storage.objects for update to authenticated
using (
  bucket_id = 'sales-imports'
  and exists (
    select 1
    from public.sales_import_batches b
    where b.organization_id::text = (storage.foldername(name))[1]
      and b.id::text = (storage.foldername(name))[2]
      and private.is_org_member(b.organization_id)
      and private.can_location(b.location_id)
      and private.has_org_role(b.organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
)
with check (
  bucket_id = 'sales-imports'
  and lower(storage.extension(name)) = 'csv'
  and exists (
    select 1
    from public.sales_import_batches b
    where b.organization_id::text = (storage.foldername(name))[1]
      and b.id::text = (storage.foldername(name))[2]
      and private.is_org_member(b.organization_id)
      and private.can_location(b.location_id)
      and private.has_org_role(b.organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

create policy sales_imports_delete_manager
on storage.objects for delete to authenticated
using (
  bucket_id = 'sales-imports'
  and exists (
    select 1
    from public.sales_import_batches b
    where b.organization_id::text = (storage.foldername(name))[1]
      and b.id::text = (storage.foldername(name))[2]
      and private.is_org_member(b.organization_id)
      and private.can_location(b.location_id)
      and private.has_org_role(b.organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

;
