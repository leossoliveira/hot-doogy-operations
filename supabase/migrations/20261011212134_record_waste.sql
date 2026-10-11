alter table public.waste_events add column if not exists reported_by_name text;
create function private.record_waste(p_id uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org uuid:='6013ed02-626a-497c-b951-619069035532'; actor uuid:=auth.uid();
 loc uuid:=(p->>'locationId')::uuid; item uuid:=(p->>'itemId')::uuid; area uuid:=(p->>'areaId')::uuid;
 unit_id uuid:=(p->>'unitId')::uuid; qty numeric:=(p->>'quantity')::numeric; at_time timestamptz:=(p->>'occurredAt')::timestamptz;
 factor numeric; result jsonb; old private.web_commands%rowtype;
begin
 if actor is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'You do not have permission to record waste.' using errcode='42501';end if;
 if p_id is null then raise exception 'Invalid waste record.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into old from private.web_commands where command_id=p_id;
 if found then
  if old.actor<>actor or old.payload<>jsonb_build_object('action','waste','payload',p) then raise exception 'This waste request has changed. Reopen the form.';end if;
  return old.result;
 end if;
 if not exists(select 1 from public.locations where id=loc and organization_id=org) or not private.can_location(loc) then raise exception 'Invalid waste location.';end if;
 if not exists(select 1 from public.storage_areas where id=area and location_id=loc and organization_id=org) or not private.can_storage(area) then raise exception 'Invalid waste storage area.';end if;
 if not exists(select 1 from public.inventory_items i join public.location_inventory_items l on l.inventory_item_id=i.id where i.id=item and i.organization_id=org and i.active and l.location_id=loc and l.active) then raise exception 'Item is unavailable at this location.';end if;
 select quantity_in_base_unit into factor from public.inventory_item_units where id=unit_id and inventory_item_id=item and organization_id=org;
 if factor is null or factor<=0 or qty is null or qty<=0 or qty>1000000 or factor*qty>1000000000 then raise exception 'Invalid waste quantity or unit.';end if;
 if at_time is null or not isfinite(at_time) or at_time>now()+interval '5 minutes' or at_time<date '2000-01-01' then raise exception 'Invalid waste date.';end if;
 if coalesce(p->>'reason','') not in ('Expired','Spoiled','Preparation error','Overproduction','Damaged','Other') or length(coalesce(p->>'notes',''))>4000 then raise exception 'Choose a waste reason and valid notes.';end if;
 insert into public.waste_events(id,organization_id,location_id,occurred_at,reason,reported_by,notes,reported_by_name) values(p_id,org,loc,at_time,p->>'reason',actor,p->>'notes',(select coalesce(nullif(raw_user_meta_data->>'full_name',''),nullif(raw_user_meta_data->>'name',''),'Team member') from auth.users where id=actor));
 insert into public.waste_event_lines(waste_event_id,inventory_item_id,storage_area_id,inventory_item_unit_id,quantity,quantity_base) values(p_id,item,area,unit_id,qty,qty*factor);
 insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by) values(org,loc,area,item,'waste',-qty*factor,'waste_events',p_id,at_time,actor);
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,loc,actor,'create','waste_event',p_id,p);
 result:=jsonb_build_object('id',p_id,'recorded',true);
 insert into private.web_commands(command_id,actor,payload,result) values(p_id,actor,jsonb_build_object('action','waste','payload',p),result);
 return result;
end $$;
revoke all on function private.record_waste(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.record_waste(uuid,jsonb) to authenticated;
create function public.record_waste(p_id uuid,p jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.record_waste(p_id,p)$$;
revoke all on function public.record_waste(uuid,jsonb) from public,anon;
grant execute on function public.record_waste(uuid,jsonb) to authenticated;
