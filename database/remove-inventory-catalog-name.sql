-- Apply with the frontend release that uses internal_name exclusively.
update public.inventory_items set internal_name=name where nullif(btrim(internal_name),'') is null;
alter table public.inventory_items alter column internal_name set not null;
do $migration$
declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in ('web_operation','internal_request_command'))
 or (n.nspname='public' and p.proname='create_transfer_plan') loop
 definition:=pg_get_functiondef(f.oid);
 definition:=replace(definition,$old$set name=sh->>'catalogName',internal_name=sh->>'internalName'$old$,$new$set internal_name=sh->>'internalName'$new$);
 definition:=replace(definition,'coalesce(internal_name,name)','internal_name');
 definition:=replace(definition,'i.id,i.internal_name,i.name,q.qty','i.id,i.internal_name,q.qty');
 execute definition;
 end loop;
end $migration$;
alter table public.inventory_items drop column name;
notify pgrst,'reload schema';
