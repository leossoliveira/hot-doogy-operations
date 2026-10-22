-- Reviewed invoices can confirm historical delivery without a stock receipt.
-- Expose only that operational declaration, never financial fields.
do $migration$
declare definition text; addition text;
begin
 definition:=pg_get_functiondef('doogy_operations.receiving_daily_report(text)'::regprocedure);
 if position('''queriedAt'',now(),' in definition)=0 then
  raise exception 'Unexpected daily report projection';
 end if;
 addition:=$sql$'queriedAt',now(),
 'invoiceReceivings',(select coalesce(jsonb_agg(jsonb_build_object(
  'invoiceId',i.id,'reference',i.invoice_number,'invoiceDate',i.invoice_date,
  'orderId',i.purchase_order_id,'supplier',s.name,
  'status',i.extraction->'receiving'->>'status',
  'receivedDate',i.extraction->'receiving'->>'receivedDate',
  'receivedBy',i.extraction->'receiving'->>'receivedBy') order by i.id),'[]'::jsonb)
  from public.invoices i join public.suppliers s on s.id=i.supplier_id and s.organization_id=org
  where i.organization_id=org and i.location_id=loc
   and i.status::text not in ('draft','cancelled','rejected')
   and i.extraction->'receiving'->>'status'='received'),$sql$;
 definition:=replace(definition,'''queriedAt'',now(),',addition);
 execute definition;
end $migration$;
