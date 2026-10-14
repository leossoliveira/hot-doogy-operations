-- Edit a submitted internal request atomically: quantities, units, added or removed items and notes.
create or replace function private.edit_internal_request(p_request uuid,p_organization uuid,p_lines jsonb,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.internal_requests; x jsonb; qty numeric; item uuid; selected_unit uuid; factor numeric; item_name text; before_lines jsonb; kept uuid[]:='{}';
begin
 select * into req from public.internal_requests where id=p_request and organization_id=p_organization for update;
 if req.id is null or auth.uid() is null or not coalesce(private.is_org_member(req.organization_id)
  and private.has_org_role(req.organization_id,array['owner','admin','manager','chef']::public.member_role[])
  and (private.can_location(req.requesting_location_id) or private.can_location(req.fulfilling_location_id)),false)
 then raise exception 'Transfer access denied' using errcode='42501';end if;
 if req.status<>'submitted' then raise exception 'Only requested transfers can be edited. Reload before saving.' using errcode='40001';end if;
 if p_notes is not null and length(p_notes)>4000 then raise exception 'Enter notes up to 4000 characters';end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'Expected 1 to 200 items';end if;
 if (select count(distinct value->>'itemId') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Each item can appear only once';end if;
 select jsonb_agg(to_jsonb(l) order by l.id) into before_lines from public.internal_request_lines l where request_id=req.id;
 for x in select value from jsonb_array_elements(p_lines) loop
  item:=(x->>'itemId')::uuid;selected_unit:=(x->>'itemUnitId')::uuid;qty:=(x->>'quantity')::numeric;
  if qty is null or qty<=0 or qty>100000000 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid quantity';end if;
  select quantity_in_base_unit into factor from public.inventory_item_units where id=selected_unit and inventory_item_id=item and organization_id=req.organization_id;
  select internal_name into item_name from public.inventory_items where id=item and organization_id=req.organization_id and active;
  if factor is null or item_name is null
   or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=req.requesting_location_id and active)
   or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=req.fulfilling_location_id and active)
  then raise exception 'Item/unit must be active and enabled in both stores';end if;
  -- Existing items keep their line identity; new items get a new line.
  update public.internal_request_lines set item_unit_id=selected_unit,unit_factor=factor,requested_quantity=qty,approved_quantity=null
   where request_id=req.id and inventory_item_id=item;
  if not found then
   insert into public.internal_request_lines(request_id,inventory_item_id,item_unit_id,unit_factor,requested_quantity,internal_name_snapshot)
   values(req.id,item,selected_unit,factor,qty,item_name);
  end if;
  kept:=kept||item;
 end loop;
 delete from public.internal_request_lines where request_id=req.id and not (inventory_item_id=any(kept));
 update public.internal_requests set notes=nullif(btrim(p_notes),'') where id=req.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,old_data,new_data) values(req.organization_id,auth.uid(),'internal_request_edited','internal_requests',req.id,jsonb_build_object('notes',req.notes,'lines',before_lines),jsonb_build_object('notes',nullif(btrim(p_notes),''),'lines',p_lines));
 return jsonb_build_object('id',req.id,'saved',true);
end $$;
revoke all on function private.edit_internal_request(uuid,uuid,jsonb,text) from public,anon;
grant execute on function private.edit_internal_request(uuid,uuid,jsonb,text) to authenticated;
create function public.edit_internal_request(p_request uuid,p_organization uuid,p_lines jsonb,p_notes text)
returns jsonb language sql security invoker set search_path='' as $$select private.edit_internal_request(p_request,p_organization,p_lines,p_notes);$$;
revoke all on function public.edit_internal_request(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.edit_internal_request(uuid,uuid,jsonb,text) to authenticated;
notify pgrst,'reload schema';
-- Rollback: redeploy the previous app, then drop public.edit_internal_request and private.edit_internal_request.
-- Requests, lines and audit history remain intact.
