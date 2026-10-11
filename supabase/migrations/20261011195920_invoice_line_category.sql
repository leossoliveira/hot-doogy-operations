-- Invoice-specific category; catalog classification is unchanged.
alter table public.invoice_lines add column source_category_id uuid references public.inventory_categories(id);
do $migration$
declare definition text;signature text;old_fragment text;
begin
 foreach signature in array array['public.save_llm_invoice_draft(uuid,jsonb)','public.edit_llm_invoice_draft(uuid,timestamptz,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  old_fragment:='line_total,source_item_type)';
  if strpos(definition,old_fragment)=0 then raise exception 'Unexpected invoice line insert';end if;
  definition:=replace(definition,old_fragment,'line_total,source_item_type,source_category_id)');
  old_fragment:=$old$nullif(line->>'item_type',''));$old$;
  if strpos(definition,old_fragment)=0 then raise exception 'Unexpected invoice line values';end if;
  definition:=replace(definition,old_fragment,$new$nullif(line->>'item_type',''),nullif(line->>'category_id','')::uuid);$new$);
  definition:=replace(definition,'insert into public.invoice_lines(', $new$if nullif(line->>'category_id','') is not null and not exists(select 1 from public.inventory_categories where id=(line->>'category_id')::uuid and organization_id=org) then raise exception 'Invalid invoice item category';end if;
  insert into public.invoice_lines($new$);
  execute definition;
 end loop;
end $migration$;
