alter table public.recipe_components add column location_id uuid references public.locations(id);
create index recipe_components_location_idx on public.recipe_components(location_id);
comment on column public.recipe_components.location_id is 'NULL applies to all locations. Non-null applies only to the specified location. Consumers must filter for NULL or their requested location.';
create function public.get_recipe_components_for_location(p_version_id uuid,p_location_id uuid)
returns setof public.recipe_components language sql stable security invoker set search_path='' as $$
select c.* from public.recipe_components c join public.locations l on l.id=p_location_id and l.organization_id=c.organization_id
where c.recipe_version_id=p_version_id and (c.location_id is null or c.location_id=p_location_id) order by c.sort_order;
$$;
revoke all on function public.get_recipe_components_for_location(uuid,uuid) from public,anon;
grant execute on function public.get_recipe_components_for_location(uuid,uuid) to authenticated,service_role;
create function private.validate_recipe_component_location() returns trigger language plpgsql security invoker set search_path='' as $$
begin
if new.location_id is not null and not exists(select 1 from public.locations l where l.id=new.location_id and l.organization_id=new.organization_id) then raise exception 'Recipe component location must belong to its organization'; end if;
return new;
end $$;
create trigger validate_recipe_component_location before insert or update of location_id,organization_id on public.recipe_components for each row execute function private.validate_recipe_component_location();
;
