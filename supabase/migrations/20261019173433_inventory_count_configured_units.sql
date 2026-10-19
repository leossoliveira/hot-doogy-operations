-- Match the count editor: any configured item unit with a positive conversion.
-- No draft, observation, quantity, permission or historical migration is rewritten.
do $migration$
declare definition text;
 old_draft text := 'and u.is_count_unit and u.quantity_in_base_unit>0';
 new_draft text := 'and u.quantity_in_base_unit>0';
 old_count text := 'and inventory_item_id=item and organization_id=org and is_count_unit;';
 new_count text := 'and inventory_item_id=item and organization_id=org and quantity_in_base_unit>0;';
begin
 definition:=pg_get_functiondef('public.save_inventory_count(jsonb)'::regprocedure);
 if strpos(definition,old_draft)=0 then raise exception 'Unexpected draft unit validation';end if;
 execute replace(definition,old_draft,new_draft);
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if strpos(definition,old_count)=0 then raise exception 'Unexpected count unit validation';end if;
 execute replace(definition,old_count,new_count);
end $migration$;
notify pgrst,'reload schema';
-- Reversal: restore the previous predicates only; preserve all saved data.
