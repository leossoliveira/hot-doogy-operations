begin;
-- Server-controlled membership, never user_metadata. This app serves one org.
create or replace function private.is_operations_staff() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m
 where m.user_id=(select auth.uid()) and m.status='active' and m.role='staff'
 and m.organization_id='6013ed02-626a-497c-b951-619069035532');
$$;
revoke all on function private.is_operations_staff() from public,anon;
grant execute on function private.is_operations_staff() to authenticated;
-- Restrictive policies never grant new access: existing org/location/storage/
-- supplier and MFA policies continue to apply. All direct writes are denied.
do $$
declare t record;
 allowed text[]:=array['organizations','organization_members','member_location_access','member_storage_area_access','member_supplier_access','locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','recipe_steps','recipe_ingredients','recipe_packaging','modifiers','menu_item_modifier_rules','internal_requests','internal_request_lines','interstore_transfers','interstore_transfer_lines','interstore_receipts','interstore_receipt_lines','store_count_observations','stock_counts','stock_count_lines','stock_count_line_entries','inventory_transactions','prep_batches','prep_batch_components','location_settings','menu_items','location_menu_items','pos_modifier_mappings','menu_item_prices','menu_categories'];
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
  execute format('create policy staff_no_insert on public.%I as restrictive for insert to authenticated with check (not (select private.is_operations_staff()))',t.relname);
  execute format('create policy staff_no_update on public.%I as restrictive for update to authenticated using (not (select private.is_operations_staff())) with check (not (select private.is_operations_staff()))',t.relname);
  execute format('create policy staff_no_delete on public.%I as restrictive for delete to authenticated using (not (select private.is_operations_staff()))',t.relname);
  if not t.relname=any(allowed) then
   execute format('create policy staff_no_read on public.%I as restrictive for select to authenticated using (not (select private.is_operations_staff()))',t.relname);
  end if;
 end loop;
end $$;
-- Private object storage must also remain read-only for Staff.
create policy staff_no_insert on storage.objects as restrictive for insert to authenticated with check (not (select private.is_operations_staff()));
create policy staff_no_update on storage.objects as restrictive for update to authenticated using (not (select private.is_operations_staff())) with check (not (select private.is_operations_staff()));
create policy staff_no_delete on storage.objects as restrictive for delete to authenticated using (not (select private.is_operations_staff()));
-- Prep can show ingredient quantities consumed, never sales amounts. Keep the
-- existing function's MFA check, organization scope, location scope and limits.
do $$
declare definition text;
begin
 select pg_get_functiondef('private.preparation_usage_period(date,date,uuid,integer,integer)'::regprocedure) into definition;
 if position('array[''owner'',''admin'',''manager'',''chef'']::public.member_role[]' in definition)=0 then raise exception 'Unexpected preparation usage authorization';end if;
 execute replace(definition,'array[''owner'',''admin'',''manager'',''chef'']::public.member_role[]','array[''owner'',''admin'',''manager'',''chef'',''staff'']::public.member_role[]');
end $$;
-- The only Staff mutation is a validated count. Check every batch entry before
-- idempotency lookup so mixed batches cannot replay previously privileged work.
do $migration$
declare definition text;
 roles text:='array[''owner'',''admin'',''manager'',''chef'']::public.member_role[]';
 expanded text:='array[''owner'',''admin'',''manager'',''chef'',''staff'']::public.member_role[]';
 batch_anchor text:='canonical:=jsonb_build_object(''actor'',auth.uid(),''action'',p_action,''payload'',p_payload);';
 batch_guard text:=$guard$if private.is_operations_staff() and exists(select 1 from jsonb_array_elements(p_payload->'changes') c where c->>'action' is distinct from 'counts') then raise exception 'Staff can save inventory counts only.' using errcode='42501';end if;
 canonical:=jsonb_build_object('actor',auth.uid(),'action',p_action,'payload',p_payload);$guard$;
 operation_anchor text:=$anchor$if p_action='catalog' then$anchor$;
 operation_guard text:=$guard$if private.is_operations_staff() and p_action is distinct from 'counts' then raise exception 'Staff can save inventory counts only.' using errcode='42501';end if;
 if p_action='catalog' then$guard$;
begin
 definition:=pg_get_functiondef('private.web_command(uuid,text,jsonb)'::regprocedure);
 if strpos(definition,roles)=0 or strpos(definition,batch_anchor)=0 then raise exception 'Unexpected web command authorization';end if;
 execute replace(replace(definition,roles,expanded),batch_anchor,batch_guard);
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if strpos(definition,roles)=0 or strpos(definition,operation_anchor)=0 then raise exception 'Unexpected web operation authorization';end if;
 execute replace(replace(definition,roles,expanded),operation_anchor,operation_guard);
end $migration$;

notify pgrst,'reload schema';
commit;
