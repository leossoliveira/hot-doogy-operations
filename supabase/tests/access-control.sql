begin;
insert into public.organizations(id,name,slug) values ('00000000-0000-4000-8000-000000000200','Synthetic other organization','synthetic-other');
insert into public.locations(id,organization_id,name,code) values
('00000000-0000-4000-8000-000000000301','6013ed02-626a-497c-b951-619069035532','Synthetic A','A'),
('00000000-0000-4000-8000-000000000302','6013ed02-626a-497c-b951-619069035532','Synthetic B','B'),
('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000200','Synthetic C','C');
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000401','manager@example.invalid'),('00000000-0000-4000-8000-000000000402','admin@example.invalid');
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values
('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000401','aal1',now(),now()),
('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000402','aal1',now(),now());
insert into public.organization_members(id,organization_id,user_id,role,status) values
('00000000-0000-4000-8000-000000000601','6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000401','manager','active'),
('00000000-0000-4000-8000-000000000602','6013ed02-626a-497c-b951-619069035532','00000000-0000-4000-8000-000000000402','admin','active');
insert into public.member_location_access(member_id,location_id) values ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000301');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000401","session_id":"00000000-0000-4000-8000-000000000501","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if (select count(*) from public.locations)<>1 then raise exception 'Manager store isolation failed';end if;
 if exists(select 1 from public.locations where id<>'00000000-0000-4000-8000-000000000301') then raise exception 'Cross-store or cross-tenant leak';end if;
 if not (public.operations_auth_status()->>'allowed')::boolean then raise exception 'Manager session incorrectly blocked';end if;
end $$;

do $$ declare name text; begin foreach name in array array['locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','recipe_steps','modifiers','menu_item_modifier_rules','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','invoices','invoice_lines','invoice_documents','internal_requests','internal_request_lines','interstore_transfers','interstore_transfer_lines','interstore_receipts','interstore_receipt_lines','store_count_observations','stock_counts','stock_count_lines','stock_count_line_entries','inventory_transactions','prep_batches','prep_batch_components','sales_item_facts','sales_import_batches','location_settings','menu_items','location_menu_items','pos_modifier_mappings','menu_item_prices','menu_categories'] loop execute format('select * from public.%I limit 0',name);end loop;end $$;
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
