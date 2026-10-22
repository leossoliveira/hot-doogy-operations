-- Some invoice-backed PO lines intentionally have no inventory mapping yet.
-- Preserve their real description/UOM; never invent a stock conversion.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('doogy_operations.receiving_daily_report(text)'::regprocedure);
 if position('coalesce(nullif(i.internal_name,''''),si.supplier_product_name)' in definition)=0
 or position('''orderedQuantity'',l.ordered_purchase_qty,''unit'',u.code' in definition)=0
 then raise exception 'Unexpected daily report projection'; end if;
 definition:=replace(definition,'coalesce(nullif(i.internal_name,''''),si.supplier_product_name)',
 'coalesce(nullif(i.internal_name,''''),si.supplier_product_name,nullif(l.description,''''))');
 definition:=replace(definition,'''orderedQuantity'',l.ordered_purchase_qty,''unit'',u.code',
 '''orderedQuantity'',l.ordered_purchase_qty,''unit'',coalesce(u.code,nullif(l.source_unit,''''))');
 execute definition;
end $migration$;
