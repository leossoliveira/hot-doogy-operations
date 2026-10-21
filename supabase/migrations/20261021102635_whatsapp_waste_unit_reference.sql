-- Avoid collision with inventory_item_units.unit_id in the production schema.
create or replace function doogy_operations.record_whatsapp_waste(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org constant uuid:='6013ed02-626a-497c-b951-619069035532';
 grp text:=p->>'groupId'; msg text:=p->>'messageId'; loc uuid;
 team uuid:=(p->>'teamMemberId')::uuid; reporter text;
 at_time timestamptz:=(p->>'occurredAt')::timestamptz;
 wid uuid:=gen_random_uuid(); tx uuid; line jsonb; factor numeric; qty numeric;
 item uuid; area uuid; selected_unit_id uuid; old doogy_operations.waste_commands%rowtype;
 movements jsonb:='[]'; result jsonb;
begin
 loc:=case grp when '120363311370740378@g.us' then 'a74401ec-ce6e-4df4-ad5d-71ce11af4351'::uuid
 when '120363402354455463@g.us' then 'd61fa7fe-fbe7-41cd-b45c-6527fae9b6b6'::uuid end;
 if loc is null or coalesce(p->>'agentId','')<>'doogy-waste-tracking' then raise exception 'Unauthorized waste group or agent.' using errcode='42501';end if;
 if p ? 'locationId' and (p->>'locationId')::uuid is distinct from loc then raise exception 'Waste location must match source group.';end if;
 if msg is null or msg !~ '^[A-Za-z0-9_-]{8,128}$' or coalesce(p->>'sourceSha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Verified source message required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(grp||':'||msg,0));
 select * into old from doogy_operations.waste_commands where group_id=grp and message_id=msg;
 if found then
  if old.payload<>p then raise exception 'Source already recorded with different payload; reconcile with Leonardo.';end if;
  if not exists(select 1 from public.waste_events where id=old.waste_id and location_id=loc and reported_team_member_id=team)
   or (select count(*) from public.waste_event_lines where waste_event_id=old.waste_id)<>jsonb_array_length(p->'lines')
   or (select count(*) from public.inventory_transactions where source_type='waste_events' and source_id=old.waste_id)<>jsonb_array_length(p->'lines')
   or exists(select 1 from jsonb_array_elements(old.result->'movements') m where not exists(select 1 from public.inventory_transactions t where t.id=(m->>'id')::uuid and t.source_id=old.waste_id and t.location_id=loc and t.inventory_item_id=(m->>'itemId')::uuid and t.storage_area_id=(m->>'areaId')::uuid and t.quantity_base=(m->>'quantityBase')::numeric))
  then raise exception 'Recorded waste no longer matches its verified movements; reconciliation required.';end if;
  return old.result;
 end if;
 select btrim(concat_ws(' ',first_name,last_name)) into reporter from public.hr_team_members
 where id=team and organization_id=org and status='active' and loc=any(location_ids);
 if reporter is null then raise exception 'Reporter must be an active team member at this location.';end if;
 if at_time is null or not isfinite(at_time) or at_time>now()+interval '5 minutes' or at_time<date '2000-01-01' then raise exception 'Invalid waste date.';end if;
 if coalesce(p->>'reason','') not in ('Expired','Spoiled','Preparation error','Overproduction','Damaged','Other') or length(coalesce(p->>'notes',''))>4000 then raise exception 'Invalid reason or notes.';end if;
 if jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'Waste lines required.';end if;
 if jsonb_array_length(p->'lines') not between 1 and 50 then raise exception 'Between 1 and 50 waste lines required.';end if;
 if exists(select 1 from jsonb_array_elements(p->'lines') l group by l->>'itemId',l->>'areaId',l->>'unitId' having count(*)>1) then raise exception 'Duplicate waste lines.';end if;
 insert into public.waste_events(id,organization_id,location_id,occurred_at,reason,reported_by,notes,reported_by_name,reported_team_member_id)
 values(wid,org,loc,at_time,p->>'reason',null,p->>'notes',reporter,team);
 for line in select * from jsonb_array_elements(p->'lines') loop
  item:=(line->>'itemId')::uuid;area:=(line->>'areaId')::uuid;selected_unit_id:=(line->>'unitId')::uuid;qty:=(line->>'quantity')::numeric;
  if not exists(select 1 from public.storage_areas where id=area and organization_id=org and location_id=loc) then raise exception 'Invalid waste storage area.';end if;
  if not exists(select 1 from public.inventory_items i join public.location_inventory_items l on l.inventory_item_id=i.id where i.id=item and i.organization_id=org and i.active and l.location_id=loc and l.active) then raise exception 'Item unavailable at source location.';end if;
  select quantity_in_base_unit into factor from public.inventory_item_units where id=selected_unit_id and inventory_item_id=item and organization_id=org;
  if factor is null or factor<=0 or factor::text in ('NaN','Infinity','-Infinity') or qty is null or qty<=0 or qty>1000000 or qty::text in ('NaN','Infinity','-Infinity') or factor*qty>1000000000 then raise exception 'Invalid waste quantity or unit.';end if;
  insert into public.waste_event_lines(waste_event_id,inventory_item_id,storage_area_id,inventory_item_unit_id,quantity,quantity_base) values(wid,item,area,selected_unit_id,qty,qty*factor);
  insert into public.inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base,source_type,source_id,occurred_at,created_by)
  values(org,loc,area,item,'waste',-qty*factor,'waste_events',wid,at_time,null) returning id into tx;
  movements:=movements||jsonb_build_array(jsonb_build_object('id',tx,'itemId',item,'areaId',area,'quantityBase',-qty*factor));
 end loop;
 result:=jsonb_build_object('id',wid,'recorded',true,'locationId',loc,'teamMemberId',team,'movements',movements);
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 values(org,loc,null,'create','waste_event',wid,jsonb_build_object('channel','whatsapp','agentId','doogy-waste-tracking','groupId',grp,'messageId',msg,'sourceSha256',p->>'sourceSha256','payload',p,'result',result));
 insert into doogy_operations.waste_commands(group_id,message_id,payload,waste_id,result) values(grp,msg,p,wid,result);
 return result;
end $$;
