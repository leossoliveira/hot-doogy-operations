-- Read only the notes belonging to a visible count, not the general audit log.
create or replace function private.inventory_count_notes(p_session uuid,p_location uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.can_location(p_location)
 or not private.is_org_member('6013ed02-626a-497c-b951-619069035532') then
  raise exception 'Count access denied' using errcode='42501';
 end if;
 if not exists(select 1 from public.store_count_observations o where o.organization_id='6013ed02-626a-497c-b951-619069035532' and o.session_id=p_session and o.location_id=p_location) then
  return jsonb_build_object('notes','','issues','[]'::jsonb);
 end if;
 select jsonb_build_object('notes',coalesce(a.new_data->>'notes',''),'issues',coalesce(a.new_data->'issues','[]'::jsonb)) into result
 from public.audit_logs a where a.organization_id='6013ed02-626a-497c-b951-619069035532'
 and a.entity_type='counts' and a.action='web_save' and a.entity_id=p_session
 and a.new_data->>'locationId'=p_location::text order by a.created_at desc limit 1;
 return coalesce(result,jsonb_build_object('notes','','issues','[]'::jsonb));
end $$;
revoke all on function private.inventory_count_notes(uuid,uuid) from public,anon;
grant execute on function private.inventory_count_notes(uuid,uuid) to authenticated;
create or replace function public.inventory_count_notes(p_session uuid,p_location uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.inventory_count_notes(p_session,p_location);
$$;
revoke all on function public.inventory_count_notes(uuid,uuid) from public,anon;
grant execute on function public.inventory_count_notes(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
