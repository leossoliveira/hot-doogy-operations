-- HR records are private to MFA-verified workspace administrators.
create table public.hr_team_members (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 first_name text not null check(length(trim(first_name)) between 1 and 100), last_name text not null check(length(trim(last_name)) between 1 and 100),
 phone text not null default '' check(length(phone)<=40), email text not null default '' check(length(email)<=254),
 status text not null default 'active' check(status in ('active','inactive')),
 permission_set text not null default 'staff' check(permission_set in ('admin','manager','chef','staff')),
 location_ids uuid[] not null check(cardinality(location_ids)>0), primary_job text not null check(length(trim(primary_job)) between 1 and 100),
 hourly_rate numeric(10,2) not null check(hourly_rate>=0 and hourly_rate<=10000), overtime_rate numeric(10,2) not null check(overtime_rate>=0 and overtime_rate<=10000),
 member_id uuid unique references public.organization_members(id),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create table public.hr_workdays (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 team_member_id uuid not null, location_id uuid not null references public.locations(id), work_date date not null,
 regular_hours numeric(5,2) not null check(regular_hours>=0), overtime_hours numeric(5,2) not null default 0 check(overtime_hours>=0),
 hourly_rate numeric(10,2) not null check(hourly_rate>=0), overtime_rate numeric(10,2) not null check(overtime_rate>=0),
 status text not null default 'draft' check(status in ('draft','approved','void')),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organization_id,team_member_id) references public.hr_team_members(organization_id,id),
 check(regular_hours+overtime_hours>0 and regular_hours+overtime_hours<=24)
);
create index hr_workdays_period on public.hr_workdays(organization_id,work_date,team_member_id);
create index hr_team_org on public.hr_team_members(organization_id);
alter table public.hr_team_members enable row level security;
alter table public.hr_workdays enable row level security;
revoke all on public.hr_team_members,public.hr_workdays from anon,authenticated;
grant select on public.hr_team_members,public.hr_workdays to authenticated;
create policy hr_team_read on public.hr_team_members for select to authenticated using(private.mfa_authorized() and private.has_org_role(organization_id,array['owner','admin']::public.member_role[]));
create policy hr_workdays_read on public.hr_workdays for select to authenticated using(private.mfa_authorized() and private.has_org_role(organization_id,array['owner','admin']::public.member_role[]));

create function public.hr_save(p_kind text,p_id uuid,p_version integer,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; emp public.hr_team_members; old_emp public.hr_team_members;
 row public.hr_workdays; old_row public.hr_workdays; locs uuid[]; before_data jsonb; result jsonb; target public.organization_members; hours numeric;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'HR access denied';end if;
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
revoke all on function public.hr_save(text,uuid,integer,jsonb) from public,anon;
grant execute on function public.hr_save(text,uuid,integer,jsonb) to authenticated;
