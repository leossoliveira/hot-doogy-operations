alter table public.recipes
  add column production_location_id uuid
  references public.locations(id) on delete restrict;

create index recipes_production_location_id_idx
  on public.recipes (production_location_id)
  where production_location_id is not null;

comment on column public.recipes.production_location_id is
  'Location where prep batches for this recipe are produced. Other locations receive the prepared output through transfer ledger entries.';
;
