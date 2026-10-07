create type public.recipe_classification as enum (
  'prep_recipe',
  'dish_recipe',
  'beverage'
);

alter table public.recipes
  add column classification public.recipe_classification;

update public.recipes r
set classification = case
  when r.recipe_type = 'prep' then 'prep_recipe'::public.recipe_classification
  when exists (
    select 1
    from public.menu_items mi
    join public.menu_categories mc on mc.id = mi.category_id
    left join public.menu_categories parent_mc on parent_mc.id = mc.parent_id
    where lower(mi.name) = lower(r.name)
      and (mc.name = 'Beverages' or parent_mc.name = 'Beverages')
  ) then 'beverage'::public.recipe_classification
  else 'dish_recipe'::public.recipe_classification
end;

alter table public.recipes
  alter column classification set not null;

create index recipes_organization_classification_idx
  on public.recipes (organization_id, classification);

comment on column public.recipes.classification is
  'Operational recipe group: prep_recipe for kitchen preparation, dish_recipe for menu-item assembly, beverage for drinks.';
;
