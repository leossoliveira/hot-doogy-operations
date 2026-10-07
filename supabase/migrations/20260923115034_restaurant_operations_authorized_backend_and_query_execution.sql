create function private.restaurant_process_sales_import(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare b public.sales_import_batches%rowtype; sr record; ev jsonb; m jsonb;
 captured integer:=0; complete_count integer:=0; errors integer:=0; report jsonb;
begin
 select * into b from public.sales_import_batches where id=p_batch_id for update;
 if not found then raise exception 'Import batch unavailable'; end if;
 if not (coalesce(auth.jwt()->>'role','')='service_role' or session_user in ('postgres','supabase_admin')) then
  if auth.uid() is null or not private.is_org_member(b.organization_id) or not private.can_location(b.location_id)
   or not private.has_org_role(b.organization_id,array['owner','admin','manager']::public.member_role[]) then
   raise exception 'Not authorized to process this sales batch' using errcode='42501';
  end if;
 end if;
 if b.pos_source<>'square_csv' or b.import_type<>'item_sales' or b.granularity<>'transaction' then raise exception 'Unsupported import format'; end if;
 for sr in select * from public.sales_import_rows where batch_id=b.id order by row_number,id loop
  ev:=private.restaurant_evaluate_sale(sr.id);
  if (ev->>'valid_sale')::boolean then
   captured:=captured+1;
   insert into public.sales_item_facts(organization_id,location_id,import_batch_id,source_row_id,menu_item_id,
    external_item_name,fact_date,period_start,period_end,granularity,quantity,gross_sales,discounts,net_sales,dimensions)
   values(b.organization_id,b.location_id,b.id,sr.id,(ev->>'menu_item_id')::uuid,ev->>'item_name',
    (ev->>'sale_date')::date,(ev->>'occurred_at')::timestamptz,(ev->>'occurred_at')::timestamptz+interval '1 microsecond',
    'transaction',(ev->>'quantity')::numeric,private.square_csv_numeric(sr.raw_data->>'Gross Sales'),
    private.square_csv_numeric(sr.raw_data->>'Discounts'),private.square_csv_numeric(sr.raw_data->>'Net Sales'),
    ev - 'usage')
   on conflict(source_row_id) where source_row_id is not null do update set
    menu_item_id=excluded.menu_item_id,external_item_name=excluded.external_item_name,fact_date=excluded.fact_date,
    period_start=excluded.period_start,period_end=excluded.period_end,quantity=excluded.quantity,
    gross_sales=excluded.gross_sales,discounts=excluded.discounts,net_sales=excluded.net_sales,dimensions=excluded.dimensions;
   for m in select * from jsonb_array_elements(ev->'modifiers') loop
    insert into public.sales_modifier_facts(organization_id,location_id,import_batch_id,source_row_id,source_position,
     modifier_id,parent_menu_item_id,external_modifier_name,fact_date,period_start,period_end,granularity,quantity,dimensions)
    values(b.organization_id,b.location_id,b.id,sr.id,(m->>'position')::integer,(m->>'modifier_id')::uuid,
     (ev->>'menu_item_id')::uuid,m->>'source_name',(ev->>'sale_date')::date,
     (ev->>'occurred_at')::timestamptz,(ev->>'occurred_at')::timestamptz+interval '1 microsecond',
     'transaction',(ev->>'quantity')::numeric,m)
    on conflict(source_row_id,source_position) where source_row_id is not null do update set
     modifier_id=excluded.modifier_id,parent_menu_item_id=excluded.parent_menu_item_id,
     external_modifier_name=excluded.external_modifier_name,fact_date=excluded.fact_date,
     period_start=excluded.period_start,period_end=excluded.period_end,quantity=excluded.quantity,dimensions=excluded.dimensions;
   end loop;
   delete from public.sales_modifier_facts f where f.source_row_id=sr.id and f.source_position>jsonb_array_length(ev->'modifiers');
  else
   delete from public.sales_modifier_facts where source_row_id=sr.id;
   delete from public.sales_item_facts where source_row_id=sr.id;
  end if;
  if ev->>'calculation_status'='complete' then complete_count:=complete_count+1; else errors:=errors+1; end if;
  update public.sales_import_rows set
   normalized_data=normalized_data||jsonb_build_object('menu_item_id',ev->'menu_item_id','modifiers',ev->'modifiers','evaluation',ev-'usage'),
   processed=(ev->>'calculation_status'='complete'),
   error_message=case when ev->>'calculation_status'='complete' then null else (ev->'issues')::text end
  where id=sr.id;
 end loop;
 report:=jsonb_build_object('batch_id',b.id,'captured_rows',captured,'complete_rows',complete_count,
  'pending_rows',errors,'status',case when errors>0 then 'completed_with_errors' else 'completed' end);
 update public.sales_import_batches set total_rows=complete_count+errors,processed_rows=complete_count,
  error_rows=errors,status=(report->>'status')::public.import_status,processed_at=now() where id=b.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 values(b.organization_id,b.location_id,auth.uid(),'process_sales_import','sales_import_batch',b.id,report);
 return report;
end $$;


revoke all on function private.restaurant_process_sales_import(uuid) from public,anon;
grant execute on function private.restaurant_process_sales_import(uuid) to authenticated,service_role;
create or replace function public.process_sales_import(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' set jit=off as $$
 select private.restaurant_process_sales_import(p_batch_id);
$$;
grant execute on function public.process_sales_import(uuid),public.process_square_csv_batch(uuid) to authenticated;
alter function private.restaurant_recipe_usage(uuid,uuid,numeric,uuid[]) set jit=off;
alter function private.restaurant_evaluate_sale(uuid) set jit=off;
alter function public.create_transfer_plan(uuid,uuid,date,date,date,date) set jit=off;
notify pgrst,'reload schema';
;
