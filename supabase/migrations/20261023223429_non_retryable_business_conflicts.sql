-- A business/version conflict is permanent for this request. SQLSTATE 40001
-- makes PostgREST 14 retry it indefinitely; PT409 returns HTTP 409 instead.
-- Preserve each installed function's body, permissions, security and settings.
do $$
declare target record; definition text;
begin
 for target in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and (n.nspname,p.proname) in (
   ('private','delete_invoice'),('private','delete_order'),
   ('private','edit_internal_request'),('private','edit_order_details'),
   ('private','edit_order_details_with_notes'),('private','preparation_sales_page'),
   ('private','report_internal_request_line_not_sent'),('private','update_invoice_status'),
   ('public','careers_review'),('public','hr_deactivate'),('public','hr_save_profile'),
   ('public','my_day_create_series'),('public','my_day_save'),('public','save_inventory_count'))
 loop
  definition:=pg_get_functiondef(target.oid);
  definition:=regexp_replace(definition,$pattern$(errcode\s*=\s*)'40001'$pattern$,$replacement$\1'PT409'$replacement$,'gi');
  execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
