begin;
insert into public.organizations(id,name,slug) values ('00000000-0000-4000-8000-000000000200','Synthetic other organization','synthetic-other');
insert into public.locations(id,organization_id,name,code) values
('00000000-0000-4000-8000-000000000301','6013ed02-626a-497c-b951-619069035532','Synthetic A','A'),
('00000000-0000-4000-8000-000000000302','6013ed02-626a-497c-b951-619069035532','Synthetic B','B'),
('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000200','Synthetic C','C');
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000401','staff@example.invalid'),('00000000-0000-4000-8000-000000000402','admin@example.invalid');
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values
('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000401','aal1',now(),now()),
('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000402','aal1',now(),now());
insert into public.organization_members(id,organization_id,user_id,role,status) values
('00000000-0000-4000-8000-000000000601','6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000401','staff','active'),
('00000000-0000-4000-8000-000000000602','6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000402','admin','active');
insert into public.member_location_access(member_id,location_id) values ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000301');

insert into public.recipes(id,organization_id,name,recipe_type,classification) values ('00000000-0000-4000-8000-000000000701','6013ed02-626a-497c-b951-619069035532','Staff test recipe','prep','prep_recipe');
-- A permissive legacy policy must not override the Staff deny policies.
grant update on public.locations to authenticated;
create policy staff_test_legacy_write on public.locations for update to authenticated using (true) with check (true);
create policy staff_test_legacy_sales on public.sales_import_batches for select to authenticated using (true);
insert into public.sales_import_batches(id,organization_id,location_id,import_type,granularity,period_start,period_end) values ('00000000-0000-4000-8000-000000000801','6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000301','item_sales','day','2026-10-01','2026-10-02');
insert into public.units(organization_id,id,code,name,kind) values ('6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000901','staff-test','Test unit','count');
insert into public.inventory_items(id,organization_id,internal_name,item_type,base_unit_id) values ('00000000-0000-4000-8000-000000000902','6013ed02-626a-497c-b951-619069035532','Test item','purchased','00000000-0000-4000-8000-000000000901');
insert into public.inventory_item_units(id,organization_id,inventory_item_id,unit_id,quantity_in_base_unit,is_base_unit,is_count_unit) values ('00000000-0000-4000-8000-000000000903','6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',1,true,true);
insert into public.location_inventory_items(organization_id,location_id,inventory_item_id) values ('6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000902');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000401","session_id":"00000000-0000-4000-8000-000000000501","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if (select count(*) from public.locations)<>1 then raise exception 'Manager store isolation failed';end if;
 if exists(select 1 from public.locations where id<>'00000000-0000-4000-8000-000000000301') then raise exception 'Cross-store or cross-tenant leak';end if;
 if not (public.operations_auth_status()->>'allowed')::boolean then raise exception 'Manager session incorrectly blocked';end if;
end $$;

do $$ declare name text; begin foreach name in array array['locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','recipe_steps','modifiers','menu_item_modifier_rules','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','invoices','invoice_lines','invoice_documents','internal_requests','internal_request_lines','interstore_transfers','interstore_transfer_lines','interstore_receipts','interstore_receipt_lines','store_count_observations','stock_counts','stock_count_lines','stock_count_line_entries','inventory_transactions','prep_batches','prep_batch_components','sales_item_facts','sales_import_batches','location_settings','menu_items','location_menu_items','pos_modifier_mappings','menu_item_prices','menu_categories'] loop execute format('select * from public.%I limit 0',name);end loop;end $$;

do $$ declare n integer; begin
 if not private.is_operations_staff() then raise exception 'Staff role not recognized';end if;
 if not exists(select 1 from public.recipes where name='Staff test recipe') then raise exception 'Recipes not readable';end if;
 if exists(select 1 from public.sales_import_batches) then raise exception 'Sales data leaked';end if;
 update public.locations set name='Unauthorized change' where id='00000000-0000-4000-8000-000000000301';
 get diagnostics n=row_count;if n<>0 then raise exception 'Staff updated a store';end if;
 begin perform public.operations_command(gen_random_uuid(),'batch','{"changes":[{"action":"production","payload":{}}]}');raise exception 'Staff RPC write allowed';exception when insufficient_privilege then null;end;
 begin perform public.catalog_create('recipe','{}',gen_random_uuid());raise exception 'Staff catalog write allowed';exception when insufficient_privilege then null;end;
 begin perform private.web_preparation_sales(0,1);raise exception 'Staff aggregate sales RPC allowed';exception when insufficient_privilege then null;end;
 if public.preparation_usage_period('2026-10-01','2026-10-02',null,0,1) is null then raise exception 'Prep read denied';end if;
end $$;
-- Save and retry a real count with notes, then reject a mixed batch atomically.
do $$ declare payload jsonb; command_id uuid:=gen_random_uuid(); count_id uuid:=gen_random_uuid(); before_count integer;begin
 payload:=jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('action','counts','payload',jsonb_build_object('id',count_id,'locationId','00000000-0000-4000-8000-000000000301','employeeName','Staff tester','date','2026-10-08','countedAt','2026-10-08T12:00:00Z','countOffsetMinutes',0,'notes','Staff count test','issues','[]'::jsonb,'lines',jsonb_build_array(jsonb_build_object('itemId','00000000-0000-4000-8000-000000000902','itemUnitId','00000000-0000-4000-8000-000000000903','qty',0))))));
 perform public.operations_command(command_id,'batch',payload);
 perform public.operations_command(command_id,'batch',payload);
 if (select count(*) from public.store_count_observations where session_id=count_id and quantity=0 and employee_name='Staff tester')<>1 then raise exception 'Count not saved exactly once';end if;
 if public.inventory_count_notes(count_id,'00000000-0000-4000-8000-000000000301')->>'notes'<>'Staff count test' then raise exception 'Count notes not readable';end if;
 begin perform public.inventory_count_notes(count_id,'00000000-0000-4000-8000-000000000302');raise exception 'Cross-store notes leaked';exception when insufficient_privilege then null;end;
 before_count:=(select count(*) from public.store_count_observations);
 begin
  perform public.operations_command(gen_random_uuid(),'batch',jsonb_set(payload,'{changes}',(payload->'changes')||'[{"action":"recipe","payload":{}}]'::jsonb));
  raise exception 'Mixed batch allowed';
 exception when insufficient_privilege then null;end;
 if (select count(*) from public.store_count_observations)<>before_count then raise exception 'Mixed batch partially saved';end if;
 begin
  perform public.operations_command(gen_random_uuid(),'batch',jsonb_set(payload,'{changes,0,payload,locationId}','"00000000-0000-4000-8000-000000000302"'::jsonb));
  raise exception 'Cross-store count allowed' using errcode='ZX001';
 exception when raise_exception then null;end;
end $$;
reset role;
-- Session loss / inactive membership also removes ordinary RLS access.
update public.organization_members set status='inactive' where id='00000000-0000-4000-8000-000000000601';
set local role authenticated;
do $$ begin if exists(select 1 from public.recipes where name='Staff test recipe') then raise exception 'Inactive member can read recipes';end if;end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000402","session_id":"00000000-0000-4000-8000-000000000502","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if (select count(*) from public.locations)<>0 then raise exception 'Admin without MFA can read locations';end if;
 if (public.operations_auth_status()->>'allowed')::boolean then raise exception 'Admin without MFA allowed';end if;
end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.locations;raise exception 'Anonymous read unexpectedly allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
