-- Recovery requested for October 8 counts. Preserve original quantities and units.
-- Existing observations without a unique assignment remain unresolved.
alter table public.store_count_observations
 add column storage_area_id uuid references public.storage_areas(id),
 add column storage_area_recovery_basis text,
 add column storage_area_recovered_at timestamptz;

with candidates as (
 select o.id, min(a.storage_area_id::text)::uuid area_id
 from public.store_count_observations o
 join public.organizations org on org.id=o.organization_id
 join public.inventory_item_storage_areas a on a.organization_id=o.organization_id
  and a.location_id=o.location_id and a.inventory_item_id=o.inventory_item_id
 join public.storage_areas s on s.id=a.storage_area_id
  and s.organization_id=o.organization_id and s.location_id=o.location_id
 where o.counted_on=date '2026-10-08'
  and org.name='Hot Doogy Franchising Corporation'
  and o.storage_area_id is null
 group by o.id having count(distinct a.storage_area_id)=1
)
update public.store_count_observations o
set storage_area_id=c.area_id,
 storage_area_recovery_basis='single_current_assignment',
 storage_area_recovered_at=now()
from candidates c where o.id=c.id;

comment on column public.store_count_observations.storage_area_recovery_basis is
 'Recovery provenance, not an original count entry. single_current_assignment links the recorded quantity to the sole current item/store area.';
notify pgrst,'reload schema';
