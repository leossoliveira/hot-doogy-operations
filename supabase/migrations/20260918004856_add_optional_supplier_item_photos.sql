alter table public.supplier_items
  add column if not exists photo_path text;

alter table public.supplier_items
  add constraint supplier_items_photo_path_matches_item
  check (
    photo_path is null
    or photo_path like organization_id::text || '/' || id::text || '/%'
  );

comment on column public.supplier_items.photo_path is
  'Optional private Storage path for the supplier item photo. Format: organization_id/supplier_item_id/file-name.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-item-images',
  'supplier-item-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy supplier_item_images_select on storage.objects
for select to authenticated
using (
  bucket_id = 'supplier-item-images'
  and exists (
    select 1
    from public.supplier_items si
    where si.organization_id::text = (storage.foldername(name))[1]
      and si.id::text = (storage.foldername(name))[2]
      and private.is_org_member(si.organization_id)
      and private.can_supplier(si.supplier_id)
  )
);

create policy supplier_item_images_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'supplier-item-images'
  and exists (
    select 1
    from public.supplier_items si
    where si.organization_id::text = (storage.foldername(name))[1]
      and si.id::text = (storage.foldername(name))[2]
      and private.is_org_member(si.organization_id)
      and private.can_supplier(si.supplier_id)
      and private.has_org_role(si.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy supplier_item_images_update on storage.objects
for update to authenticated
using (
  bucket_id = 'supplier-item-images'
  and exists (
    select 1
    from public.supplier_items si
    where si.organization_id::text = (storage.foldername(name))[1]
      and si.id::text = (storage.foldername(name))[2]
      and private.is_org_member(si.organization_id)
      and private.can_supplier(si.supplier_id)
      and private.has_org_role(si.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
)
with check (
  bucket_id = 'supplier-item-images'
  and exists (
    select 1
    from public.supplier_items si
    where si.organization_id::text = (storage.foldername(name))[1]
      and si.id::text = (storage.foldername(name))[2]
      and private.is_org_member(si.organization_id)
      and private.can_supplier(si.supplier_id)
      and private.has_org_role(si.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);

create policy supplier_item_images_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'supplier-item-images'
  and exists (
    select 1
    from public.supplier_items si
    where si.organization_id::text = (storage.foldername(name))[1]
      and si.id::text = (storage.foldername(name))[2]
      and private.is_org_member(si.organization_id)
      and private.can_supplier(si.supplier_id)
      and private.has_org_role(si.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])
  )
);
;
