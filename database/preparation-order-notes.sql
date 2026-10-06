-- Preserve the live function's authorization and other commands; change only notes mapping.
do $migration$
declare definition text; old_mapping text := $old$'notes',p->>'number','lines',x$old$;
new_mapping text := $new$'notes',coalesce(nullif(btrim(p->>'notes'),''),p->>'number'),'lines',x$new$;
begin
 definition := pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if position(new_mapping in definition)>0 then return; end if;
 if position(old_mapping in definition)=0 then raise exception 'Expected transfer notes mapping was not found'; end if;
 execute replace(definition,old_mapping,new_mapping);
end $migration$;
