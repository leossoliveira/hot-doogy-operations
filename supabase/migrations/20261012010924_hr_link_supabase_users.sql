-- Imported accounts retain unknown personnel/compensation fields as NULL.
alter table public.hr_team_members alter column first_name drop not null,alter column last_name drop not null,alter column primary_job drop not null,alter column hourly_rate drop not null,alter column overtime_rate drop not null;
alter table public.hr_team_members drop constraint hr_team_members_permission_set_check,drop constraint hr_team_members_location_ids_check;
alter table public.hr_team_members add constraint hr_team_members_permission_set_check check(permission_set in ('owner','admin','manager','chef','staff','employee','viewer'));

create function public.hr_user_directory() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';result jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'HR access denied';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'user_id',u.id,'role',m.role,'status',m.status,'email',u.email,'name',coalesce(nullif(trim(p.full_name),''),u.email),'location_ids',case when m.role in ('owner','admin') then (select coalesce(jsonb_agg(l.id),'[]') from public.locations l where l.organization_id=org) else (select coalesce(jsonb_agg(a.location_id),'[]') from public.member_location_access a join public.locations l on l.id=a.location_id where a.member_id=m.id and l.organization_id=org) end) order by u.email),'[]') into result
 from public.organization_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=u.id where m.organization_id=org;
 return result;
end $$;
revoke all on function public.hr_user_directory() from public,anon;
grant execute on function public.hr_user_directory() to authenticated;

create function public.hr_import_users() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';r record;emp public.hr_team_members;locs uuid[];full_name text;imported integer:=0;linked integer:=0;skipped integer:=0;matches integer;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'HR access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('hr_import:'||org::text,0));
 for r in select m.id member_id,m.user_id,m.role,m.status,u.email,coalesce(nullif(trim(p.phone),''),u.phone,'') phone,p.full_name from public.organization_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=u.id where m.organization_id=org order by m.id loop
  if exists(select 1 from public.hr_team_members where member_id=r.member_id) then skipped:=skipped+1;continue;end if;
  if r.role in ('owner','admin') then select coalesce(array_agg(id order by id),'{}'::uuid[]) into locs from public.locations where organization_id=org;
  else select coalesce(array_agg(a.location_id order by a.location_id),'{}'::uuid[]) into locs from public.member_location_access a join public.locations l on l.id=a.location_id where a.member_id=r.member_id and l.organization_id=org;end if;
  select count(*) into matches from public.hr_team_members where organization_id=org and nullif(lower(trim(email)),'')=nullif(lower(trim(r.email)),'');
  if matches>1 or exists(select 1 from public.hr_team_members where organization_id=org and nullif(lower(trim(email)),'')=nullif(lower(trim(r.email)),'') and member_id is not null) then skipped:=skipped+1;continue;end if;
  if matches=1 then
   update public.hr_team_members set member_id=r.member_id,permission_set=r.role::text,location_ids=locs,version=version+1,updated_at=now() where organization_id=org and lower(trim(email))=lower(trim(r.email)) and member_id is null returning * into emp;
   linked:=linked+1;
  else
   full_name:=nullif(trim(r.full_name),'');
   insert into public.hr_team_members(organization_id,first_name,last_name,email,phone,status,permission_set,location_ids,primary_job,hourly_rate,overtime_rate,member_id)
   values(org,nullif(left(split_part(full_name,' ',1),100),''),case when position(' ' in full_name)>0 then nullif(left(trim(substring(full_name from position(' ' in full_name)+1)),100),'') else null end,coalesce(r.email,''),left(r.phone,40),case when r.status='active' then 'active' else 'inactive' end,r.role::text,locs,null,null,null,r.member_id) returning * into emp;
   imported:=imported+1;
  end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,new_data) values(org,auth.uid(),'hr.import_user','hr_team',emp.id,jsonb_build_object('member_id',r.member_id,'user_id',r.user_id));
 end loop;
 return jsonb_build_object('imported',imported,'linked',linked,'skipped',skipped);
end $$;
revoke all on function public.hr_import_users() from public,anon;
grant execute on function public.hr_import_users() to authenticated;

create or replace function public.hr_save(p_kind text,p_id uuid,p_version integer,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; emp public.hr_team_members; old_emp public.hr_team_members;
 row public.hr_workdays; old_row public.hr_workdays; locs uuid[]; before_data jsonb; result jsonb; target public.organization_members; hours numeric;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'HR access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('hr_save:'||coalesce(p_id::text,''),0));
 if p_id is null or p_version is null then raise exception 'HR invalid record';end if;
 if p_kind='team' then
  select * into old_emp from public.hr_team_members where id=p_id and organization_id=org for update;
  if (old_emp.id is null and p_version<>0) or (old_emp.id is not null and old_emp.version<>p_version) then raise exception 'HR record changed. Reload and retry.';end if;
  if exists(select 1 from public.hr_team_members where id=p_id and organization_id<>org) then raise exception 'HR access denied';end if;
  select array_agg(distinct value::uuid) into locs from jsonb_array_elements_text(p->'location_ids');
  if coalesce(cardinality(locs),0)=0 or exists(select 1 from unnest(locs) l where not exists(select 1 from public.locations where id=l and organization_id=org)) then raise exception 'HR invalid locations';end if;
  if old_emp.member_id is not null and (p->>'permission_set'<>old_emp.permission_set or locs<>old_emp.location_ids) then raise exception 'HR use Permissions to change linked access';end if;
  insert into public.hr_team_members(id,organization_id,first_name,last_name,phone,email,status,permission_set,location_ids,primary_job,hourly_rate,overtime_rate)
  values(p_id,org,trim(p->>'first_name'),trim(p->>'last_name'),coalesce(p->>'phone',''),coalesce(p->>'email',''),p->>'status',p->>'permission_set',locs,trim(p->>'primary_job'),(p->>'hourly_rate')::numeric,(p->>'overtime_rate')::numeric)
  on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,email=excluded.email,status=excluded.status,permission_set=excluded.permission_set,location_ids=excluded.location_ids,primary_job=excluded.primary_job,hourly_rate=excluded.hourly_rate,overtime_rate=excluded.overtime_rate,version=hr_team_members.version+1,updated_at=now()
  returning * into emp;
  before_data=to_jsonb(old_emp);result=to_jsonb(emp);
 elsif p_kind='workday' then
  select * into old_row from public.hr_workdays where id=p_id and organization_id=org for update;
  if (old_row.id is null and p_version<>0) or (old_row.id is not null and old_row.version<>p_version) then raise exception 'HR record changed. Reload and retry.';end if;
  if exists(select 1 from public.hr_workdays where id=p_id and organization_id<>org) then raise exception 'HR access denied';end if;
  select * into emp from public.hr_team_members where id=(p->>'team_member_id')::uuid and organization_id=org for update;
  if emp.id is null or (old_row.id is null and emp.status<>'active') or not ((p->>'location_id')::uuid=any(emp.location_ids)) then raise exception 'HR invalid team member or location';end if;
  if old_row.id is null and (emp.hourly_rate is null or emp.overtime_rate is null or emp.primary_job is null) then raise exception 'HR complete job and hourly rates before recording hours';end if;
  if old_row.id is not null and old_row.team_member_id<>emp.id then raise exception 'HR cannot reassign a workday';end if;
  if (p->>'work_date')::date> (now() at time zone 'America/New_York')::date then raise exception 'HR work date cannot be in the future';end if;
  -- Employee lock serializes all entries across locations for this employee.
  select coalesce(sum(regular_hours+overtime_hours),0) into hours from public.hr_workdays where team_member_id=emp.id and work_date=(p->>'work_date')::date and status<>'void' and id<>p_id;
  if p->>'status'<>'void' and hours+(p->>'regular_hours')::numeric+(p->>'overtime_hours')::numeric>24 then raise exception 'HR daily hours exceed 24';end if;
  insert into public.hr_workdays(id,organization_id,team_member_id,location_id,work_date,regular_hours,overtime_hours,hourly_rate,overtime_rate,status)
  values(p_id,org,emp.id,(p->>'location_id')::uuid,(p->>'work_date')::date,(p->>'regular_hours')::numeric,(p->>'overtime_hours')::numeric,coalesce(old_row.hourly_rate,emp.hourly_rate),coalesce(old_row.overtime_rate,emp.overtime_rate),p->>'status')
  on conflict(id) do update set location_id=excluded.location_id,work_date=excluded.work_date,regular_hours=excluded.regular_hours,overtime_hours=excluded.overtime_hours,status=excluded.status,version=hr_workdays.version+1,updated_at=now() returning * into row;
  before_data=to_jsonb(old_row);result=to_jsonb(row);
 elsif p_kind='access' then
  select * into emp from public.hr_team_members where id=p_id and organization_id=org for update;
  if emp.id is null or emp.version<>p_version then raise exception 'HR record changed. Reload and retry.';end if;
  select * into target from public.organization_members where id=(p->>'member_id')::uuid and organization_id=org and status='active' for update;
  if target.id is null or target.role='owner' or target.user_id=auth.uid() or (emp.member_id is not null and emp.member_id<>target.id) then raise exception 'HR invalid account. Owner and own access cannot be changed.';end if;
  if p->>'permission_set' not in ('admin','manager','chef','staff') then raise exception 'HR invalid permission set';end if;
  if (target.role='admin' or p->>'permission_set'='admin') and not private.has_org_role(org,array['owner']::public.member_role[]) then raise exception 'HR only owners can manage administrator access';end if;
  select array_agg(distinct value::uuid) into locs from jsonb_array_elements_text(p->'location_ids');
  if coalesce(cardinality(locs),0)=0 or exists(select 1 from unnest(locs) l where not exists(select 1 from public.locations where id=l and organization_id=org)) then raise exception 'HR invalid locations';end if;
  before_data=jsonb_build_object('team',to_jsonb(emp),'account',to_jsonb(target),'locations',(select jsonb_agg(location_id) from public.member_location_access where member_id=target.id));
  update public.organization_members set role=(p->>'permission_set')::public.member_role where id=target.id;
  delete from public.member_location_access where member_id=target.id;
  insert into public.member_location_access(member_id,location_id) select target.id,unnest(locs);
  update public.hr_team_members set member_id=target.id,permission_set=p->>'permission_set',location_ids=locs,version=version+1,updated_at=now() where id=emp.id returning * into emp;
  result=to_jsonb(emp);
 else raise exception 'HR invalid action';end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,old_data,new_data) values(org,auth.uid(),'hr.'||p_kind,'hr_'||p_kind,p_id,before_data,result);
 return result;
end $$;
