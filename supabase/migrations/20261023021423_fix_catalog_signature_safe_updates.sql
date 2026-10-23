-- This is deliberately a global invalidation: units and other catalog sources
-- can be shared. Keep the generation bump even when signature is already null
-- so an in-flight computation cannot publish a stale signature. The explicit
-- primary-key predicate is required by the production safeupdate guard.
create or replace function private.invalidate_preparation_catalog_signature() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update private.preparation_catalog_signatures
 set signature=null,generation=generation+1
 where organization_id is not null;
 return null;
end $$;
revoke all on function private.invalidate_preparation_catalog_signature() from public,anon,authenticated,service_role;
