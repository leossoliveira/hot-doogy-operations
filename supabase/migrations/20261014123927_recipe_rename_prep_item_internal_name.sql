-- Fix 20261014122848: inventory items keep their name in internal_name (the name column was dropped on 2026-10-06).
-- Renaming a prep recipe failed with "column name does not exist" and rolled back the whole save.
do $migration$
declare definition text; occurrences integer;
old_text text := $o$if item is not null then update public.inventory_items set name=btrim(p->>'name') where inventory_items.id=item and organization_id=org;end if;$o$;
new_text text := $n$if item is not null then update public.inventory_items set internal_name=btrim(p->>'name'),updated_at=now() where inventory_items.id=item and organization_id=org;end if;$n$;
begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
 if occurrences<>1 then raise exception 'Unexpected recipe rename command';end if;
 execute replace(definition,old_text,new_text);
end $migration$;
notify pgrst,'reload schema';
