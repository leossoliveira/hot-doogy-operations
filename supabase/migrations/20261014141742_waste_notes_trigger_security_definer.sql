-- Fix 20261014141529: OpenClaw inserts waste as service_role, which has no usage on schema private.
-- The trigger must run with its owner's rights to call private.waste_human_notes; otherwise those inserts fail.
create or replace function private.waste_strip_automatic_notes() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reported_by is null then new.notes:=private.waste_human_notes(new.notes);end if;
 return new;
end $$;
revoke all on function private.waste_strip_automatic_notes() from public,anon,authenticated;
