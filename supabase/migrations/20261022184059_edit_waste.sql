-- Correct one waste line atomically. Keep original attribution and append only the stock delta.
create function private.edit_waste(p_id uuid,p_line_id uuid,p jsonb,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org uuid:='6013ed02-626a-497c-b951-619069035532'; actor uuid:=auth.uid();
 event public.waste_events%rowtype; line public.waste_event_lines%rowtype;
 old private.web_commands%rowtype; command jsonb:=jsonb_build_object('action','edit_waste','lineId',p_line_id,'payload',p,'expected',p_expected);
 unit_id uuid:=(p->>'unitId')::uuid; qty numeric:=(p->>'quantity')::numeric;
 factor numeric; delta numeric; result jsonb; snapshot jsonb;
begin
 if actor is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'You do not have permission to edit waste.' using errcode='42501';end if;
 if p_id is null or p_line_id is null then raise exception 'Invalid waste record.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into old from private.web_commands where command_id=p_id;
 if found then
  if old.actor<>actor or old.payload<>command then raise exception 'This waste request has changed. Reopen the form.';end if;
  return old.result;
 end if;
 -- All lines of an event share reason/notes, so serialize through the event first.
 select w.* into event from public.waste_events w join public.waste_event_lines l on l.waste_event_id=w.id where l.id=p_line_id and w.organization_id=org for update of w;
 if not found or not private.can_location(event.location_id) then raise exception 'Waste record is unavailable.' using errcode='42501';end if;
 select * into line from public.waste_event_lines where id=p_line_id for update;
 if not private.can_storage(line.storage_area_id) then raise exception 'Waste storage area is unavailable.' using errcode='42501';end if;
 snapshot:=jsonb_build_object('quantity',line.quantity,'unitId',line.inventory_item_unit_id,'quantityBase',line.quantity_base,'reason',event.reason,'notes',coalesce(event.notes,''));
 if p_expected is distinct from snapshot then raise exception 'This waste was changed by someone else. Close and reopen it before saving.';end if;
 if (p->>'locationId')::uuid is distinct from event.location_id or (p->>'itemId')::uuid is distinct from line.inventory_item_id or (p->>'areaId')::uuid is distinct from line.storage_area_id then raise exception 'The original waste item and location must be preserved.';end if;
 select quantity_in_base_unit into factor from public.inventory_item_units where id=unit_id and inventory_item_id=line.inventory_item_id and organization_id=org;
 if factor is null or factor<=0 or qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>1000000 or qty*factor>1000000000 then raise exception 'Invalid waste quantity or unit.';end if;
 if (coalesce(p->>'reason','') not in ('Expired','Spoiled','Preparation error','Overproduction','Damaged','Other') and p->>'reason' is distinct from event.reason) or length(coalesce(p->>'notes',''))>4000 then raise exception 'Choose a waste reason and valid notes.';end if;
 delta:=line.quantity_base-qty*factor;
 update public.waste_event_lines set inventory_item_unit_id=unit_id,quantity=qty,quantity_base=qty*factor,estimated_cost=null where id=p_line_id;
 update public.waste_events set reason=p->>'reason',notes=p->>'notes' where id=event.id;
 if delta<>0 then
  insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by)
  values(org,event.location_id,line.storage_area_id,line.inventory_item_id,'waste',delta,'waste_events',event.id,event.occurred_at,actor);
 end if;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,event.location_id,actor,'update','waste_event',event.id,jsonb_build_object('lineId',p_line_id,'before',snapshot,'after',p,'inventoryDelta',delta));
 result:=jsonb_build_object('id',event.id,'lineId',p_line_id,'updated',true);
 insert into private.web_commands(command_id,actor,payload,result) values(p_id,actor,command,result);
 return result;
end $$;
revoke all on function private.edit_waste(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.edit_waste(uuid,uuid,jsonb,jsonb) to authenticated;
create function public.edit_waste(p_id uuid,p_line_id uuid,p jsonb,p_expected jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.edit_waste(p_id,p_line_id,p,p_expected)$$;
revoke all on function public.edit_waste(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.edit_waste(uuid,uuid,jsonb,jsonb) to authenticated;
