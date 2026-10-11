-- Invoice-specific classification; does not change the inventory catalog.
alter table public.invoice_lines add column source_item_type text check(source_item_type in ('purchased','prepared'));
do $migration$
declare definition text;signature text;old_fragment text;
begin
 foreach signature in array array['public.save_llm_invoice_draft(uuid,jsonb)','public.edit_llm_invoice_draft(uuid,timestamptz,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  old_fragment:='item_unit_id,source_unit,quantity,quantity_base,unit_price,line_total)';
  if strpos(definition,old_fragment)=0 then raise exception 'Unexpected invoice line insert';end if;
  definition:=replace(definition,old_fragment,'item_unit_id,source_unit,quantity,quantity_base,unit_price,line_total,source_item_type)');
  old_fragment:=$old$(line->>'unit_price')::numeric,(line->>'line_total')::numeric);$old$;
  if strpos(definition,old_fragment)=0 then raise exception 'Unexpected invoice line values';end if;
  definition:=replace(definition,old_fragment,$new$(line->>'unit_price')::numeric,(line->>'line_total')::numeric,nullif(line->>'item_type',''));$new$);
  execute definition;
 end loop;
end $migration$;
