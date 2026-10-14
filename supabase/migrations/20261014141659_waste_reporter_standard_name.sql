-- Waste records keep the same reporter name the app shows in the form and uses for prep batches and requests,
-- instead of the raw sign-up metadata name.
do $migration$
declare definition text; occurrences integer;
old_text text := $o$(select coalesce(nullif(raw_user_meta_data->>'full_name',''),nullif(raw_user_meta_data->>'name',''),'Team member') from auth.users where id=actor)$o$;
new_text text := $n$private.internal_request_requester_name(org,actor)$n$;
begin
 definition:=pg_get_functiondef('private.record_waste(uuid,jsonb)'::regprocedure);
 occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
 if occurrences<>1 then raise exception 'Unexpected waste reporter expression';end if;
 execute replace(definition,old_text,new_text);
end $migration$;
