alter table public.hr_team_members add column phone_country text check(phone_country ~ '^[A-Z]{2}$');
-- This affects workspace membership only; historical HR entries and Auth identities remain intact.
create function public.hr_deactivate(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; emp public.hr_team_members;target public.organization_members;result jsonb;before_data jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'HR access denied' using errcode='42501';end if;
 if exists(select 1 from public.hr_permission_profiles p join public.organization_members m on m.organization_id=p.organization_id and m.role::text=p.role where m.user_id=auth.uid() and m.organization_id=org and (p.permissions->'hr'->>'view'='false' or p.permissions->'hr'->>'write'='false')) then raise exception 'HR saving denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('hr_save:'||coalesce(p_id::text,''),0));
 select * into emp from public.hr_team_members where id=p_id and organization_id=org for update;
 if emp.id is null or p_version is null or emp.version<>p_version then raise exception 'HR record changed. Reload and retry.' using errcode='40001';end if;
 if emp.permission_set='owner' then raise exception 'Owner accounts cannot be deactivated' using errcode='42501';end if;
 if emp.member_id is not null then
  select * into target from public.organization_members where id=emp.member_id and organization_id=org for update;
  if target.id is null or target.role='owner' or target.user_id=auth.uid() then raise exception 'Owner and own accounts cannot be deactivated' using errcode='42501';end if;
  if target.role='admin' and not private.has_org_role(org,array['owner']::public.member_role[]) then raise exception 'Only an owner can deactivate administrators' using errcode='42501';end if;
 end if;
 before_data:=jsonb_build_object('team',to_jsonb(emp),'account',to_jsonb(target));
 update public.organization_members set status='inactive' where id=emp.member_id and organization_id=org;
 update public.hr_team_members set status='inactive',version=version+1,updated_at=now() where id=p_id returning to_jsonb(hr_team_members.*) into result;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,old_data,new_data) values(org,auth.uid(),'hr.deactivate','hr_team',p_id,before_data,result);
 return result;
end $$;
revoke all on function public.hr_deactivate(uuid,integer) from public,anon;
grant execute on function public.hr_deactivate(uuid,integer) to authenticated;
-- Retain the existing transaction/authorization and wage-history behavior.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.hr_save(text,uuid,integer,jsonb)'::regprocedure);
 if position('coalesce(p->>''phone'','''')' in definition)=0 or position('trim(p->>''primary_job'')' in definition)=0 then raise exception 'Unexpected HR save definition';end if;
 definition:=replace(definition,'first_name,last_name,phone,email,status','first_name,last_name,phone,phone_country,email,status');
 definition:=replace(definition,'coalesce(p->>''phone'','''')','coalesce(p->>''phone'',''''),nullif(p->>''phone_country'','''')');
 definition:=replace(definition,'phone=excluded.phone,email=','phone=excluded.phone,phone_country=excluded.phone_country,email=');
 definition:=replace(definition,'trim(p->>''primary_job'')','nullif(trim(p->>''primary_job''),'''')');
 definition:=replace(definition,'(p->>''hourly_rate'')::numeric','nullif(p->>''hourly_rate'','''')::numeric');
 definition:=replace(definition,'(p->>''overtime_rate'')::numeric','nullif(p->>''overtime_rate'','''')::numeric');
 -- Saving an inactive status must also block linked system access, with the same safeguards.
 definition:=replace(definition,'before_data=to_jsonb(old_emp);result=to_jsonb(emp);','before_data=to_jsonb(old_emp);result=to_jsonb(emp);
  if emp.status=''inactive'' and emp.member_id is not null and exists(select 1 from public.organization_members where id=emp.member_id and status=''active'') then result:=public.hr_deactivate(emp.id,emp.version);end if;');
 execute definition;
end $$;
notify pgrst,'reload schema';
