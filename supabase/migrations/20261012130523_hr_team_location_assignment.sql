-- Location assignments belong to the Team member, independently of permission profiles.
-- Retain version checks, tenant validation, role protection and existing account policies.
do $migration$
declare definition text; old_guard text; new_guard text; access_start integer; access_definition text;
begin
 definition:=pg_get_functiondef('public.hr_save(text,uuid,integer,jsonb)'::regprocedure);
 old_guard:=$old$if old_emp.member_id is not null and (p->>'permission_set'<>old_emp.permission_set or locs<>old_emp.location_ids) then raise exception 'HR use Permissions to change linked access';end if;$old$;
 new_guard:=$new$if old_emp.member_id is not null then
   if p->>'permission_set' is distinct from old_emp.permission_set then raise exception 'HR use Permissions to change linked access';end if;
   select * into target from public.organization_members where id=old_emp.member_id and organization_id=org for update;
   if target.id is null then raise exception 'HR invalid linked account';end if;
   if locs is distinct from old_emp.location_ids then
    if target.role in ('owner','admin') and not private.has_org_role(org,array['owner']::public.member_role[]) then raise exception 'HR only owners can manage administrator access';end if;
    delete from public.member_location_access where member_id=target.id;
    insert into public.member_location_access(member_id,location_id) select target.id,unnest(locs);
   end if;
  end if;$new$;
 if position(old_guard in definition)=0 then raise exception 'Unexpected HR linked access guard';end if;
 definition:=replace(definition,old_guard,new_guard);
 access_start:=position('elsif p_kind=''access'' then' in definition);
 if access_start=0 then raise exception 'Missing HR access branch';end if;
 access_definition:=substring(definition from access_start);
 if position('select array_agg(distinct value::uuid) into locs from jsonb_array_elements_text(p->''location_ids'');' in access_definition)=0 then raise exception 'Unexpected HR location assignment';end if;
 -- Ignore legacy clients' location payload. Linking an account uses the locations already saved in Team.
 access_definition:=replace(access_definition,'select array_agg(distinct value::uuid) into locs from jsonb_array_elements_text(p->''location_ids'');','locs:=emp.location_ids;');
 definition:=substring(definition from 1 for access_start-1)||access_definition;
 execute definition;
end $migration$;
notify pgrst,'reload schema';
