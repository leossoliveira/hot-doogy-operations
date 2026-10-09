-- Correct a saved count row atomically. Never post a new inventory movement.
create function private.edit_inventory_count(p_source text,p_id uuid,p_quantity numeric,p_unit uuid,p_old_quantity numeric,p_old_unit uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; loc uuid; item uuid; line_id uuid; current_qty numeric; current_unit uuid; factor numeric; before_row jsonb; after_row jsonb; total numeric;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Count edit access denied' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<0 or p_quantity>100000000 or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid quantity';end if;
 if p_source='observations' then
  select o.location_id,o.inventory_item_id,o.quantity,o.item_unit_id,to_jsonb(o) into loc,item,current_qty,current_unit,before_row from public.store_count_observations o where o.id=p_id and o.organization_id=org for update;
 elsif p_source in ('legacy_entry','legacy_line') then
  if p_source='legacy_entry' then select e.stock_count_line_id into line_id from public.stock_count_line_entries e where e.id=p_id;else line_id:=p_id;end if;
  select s.location_id,l.inventory_item_id,to_jsonb(l),l.counted_base_quantity into loc,item,before_row,current_qty from public.stock_count_lines l join public.stock_counts s on s.id=l.stock_count_id where l.id=line_id and l.organization_id=org and s.organization_id=org and s.status='completed' for update of l;
  if p_source='legacy_entry' then
   select e.quantity,e.inventory_item_unit_id,to_jsonb(e) into current_qty,current_unit,before_row from public.stock_count_line_entries e where e.id=p_id and e.stock_count_line_id=line_id for update;
  elsif exists(select 1 from public.stock_count_line_entries e where e.stock_count_line_id=line_id) then raise exception 'Count changed. Reopen it before editing.';end if;
 else raise exception 'Invalid count source';end if;
 if loc is null or not private.can_location(loc) then raise exception 'Count edit access denied' using errcode='42501';end if;
 if current_qty is distinct from p_old_quantity or current_unit is distinct from p_old_unit then raise exception 'Count changed. Reopen it before editing.';end if;
 select u.quantity_in_base_unit into factor from public.inventory_item_units u where u.id=p_unit and u.inventory_item_id=item and u.organization_id=org;
 if factor is null or factor<=0 or factor::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid item unit';end if;
 if p_source='observations' then
  update public.store_count_observations o set quantity=p_quantity,item_unit_id=p_unit,quantity_base=p_quantity*factor where o.id=p_id returning to_jsonb(o) into after_row;
 else
  if p_source='legacy_entry' then
   update public.stock_count_line_entries e set quantity=p_quantity,inventory_item_unit_id=p_unit where e.id=p_id returning to_jsonb(e) into after_row;
  else
   insert into public.stock_count_line_entries(stock_count_line_id,inventory_item_unit_id,quantity) values(line_id,p_unit,p_quantity) returning to_jsonb(stock_count_line_entries) into after_row;
  end if;
  select sum(e.quantity*u.quantity_in_base_unit) into total from public.stock_count_line_entries e join public.inventory_item_units u on u.id=e.inventory_item_unit_id where e.stock_count_line_id=line_id;
  update public.stock_count_lines set counted_base_quantity=total,variance_base_quantity=total-expected_base_quantity where id=line_id;
 end if;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data) values(org,loc,auth.uid(),'count_quantity_unit_corrected',p_source,p_id,before_row,after_row);
 return jsonb_build_object('saved',true);
end $$;
revoke all on function private.edit_inventory_count(text,uuid,numeric,uuid,numeric,uuid) from public,anon;
grant execute on function private.edit_inventory_count(text,uuid,numeric,uuid,numeric,uuid) to authenticated;
create function public.edit_inventory_count(p_source text,p_id uuid,p_quantity numeric,p_unit uuid,p_old_quantity numeric,p_old_unit uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.edit_inventory_count(p_source,p_id,p_quantity,p_unit,p_old_quantity,p_old_unit); $$;
revoke all on function public.edit_inventory_count(text,uuid,numeric,uuid,numeric,uuid) from public,anon;
grant execute on function public.edit_inventory_count(text,uuid,numeric,uuid,numeric,uuid) to authenticated;
notify pgrst,'reload schema';
