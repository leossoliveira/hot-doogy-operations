-- My Day: location-scoped work, with status-only updates for assigned staff.
create table public.my_day_procedures (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 location_id uuid not null references public.locations(id), title text not null check(length(trim(title)) between 1 and 160),
 purpose text not null default '' check(length(purpose)<=3000), steps text not null check(length(trim(steps)) between 1 and 20000),
 verification text not null default '' check(length(verification)<=5000), status text not null check(status in ('draft','published')),
 version integer not null default 1, updated_at timestamptz not null default now(), unique(organization_id,id)
);
create table public.my_day_tasks (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 location_id uuid not null references public.locations(id), title text not null check(length(trim(title)) between 1 and 160),
 description text not null default '' check(length(description)<=10000), due_date date not null,
 priority text not null check(priority in ('low','normal','high','urgent')), status text not null check(status in ('todo','doing','done')),
 assignee_id uuid not null, procedure_id uuid, version integer not null default 1, updated_at timestamptz not null default now(),
 foreign key(organization_id,assignee_id) references public.hr_team_members(organization_id,id),
 foreign key(organization_id,procedure_id) references public.my_day_procedures(organization_id,id)
);
create index my_day_tasks_scope on public.my_day_tasks(organization_id,location_id,due_date);
create index my_day_tasks_assignee on public.my_day_tasks(assignee_id);
create index my_day_tasks_procedure on public.my_day_tasks(procedure_id);
create index my_day_procedures_scope on public.my_day_procedures(organization_id,location_id);
create function private.my_day_access(org uuid,loc uuid,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.mfa_authorized() and private.can_location(loc)
 and exists(select 1 from public.organization_members m left join public.hr_permission_profiles p on p.organization_id=m.organization_id and p.role=m.role::text
 where m.organization_id=org and m.user_id=auth.uid() and m.status='active' and m.role::text in ('owner','admin','manager','chef','staff')
 and coalesce(p.permissions->'my-day'->>'view','true')='true' and (not writing or coalesce(p.permissions->'my-day'->>'write','true')='true'))
$$;
create function private.my_day_manager(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[])
$$;
create function private.my_day_assigned(team_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hr_team_members t join public.organization_members m on m.id=t.member_id and m.organization_id=t.organization_id where t.id=team_id and t.status='active' and m.user_id=auth.uid() and m.status='active')
$$;
revoke all on function private.my_day_access(uuid,uuid,boolean),private.my_day_manager(uuid),private.my_day_assigned(uuid) from public,anon;
grant execute on function private.my_day_access(uuid,uuid,boolean),private.my_day_manager(uuid),private.my_day_assigned(uuid) to authenticated;
alter table public.my_day_tasks enable row level security;
alter table public.my_day_procedures enable row level security;
revoke all on public.my_day_tasks,public.my_day_procedures from public,anon,authenticated;
grant select on public.my_day_tasks,public.my_day_procedures to authenticated;
create policy my_day_tasks_read on public.my_day_tasks for select to authenticated using(private.my_day_access(organization_id,location_id) and (private.my_day_manager(organization_id) or private.my_day_assigned(assignee_id)));
create policy my_day_procedures_read on public.my_day_procedures for select to authenticated using(private.my_day_access(organization_id,location_id) and (status='published' or private.my_day_manager(organization_id)));
create function public.my_day_team() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'first_name',t.first_name,'last_name',t.last_name,'status',t.status,'location_ids',
 (select coalesce(jsonb_agg(l), '[]') from unnest(t.location_ids) l where private.my_day_access(t.organization_id,l)))), '[]')
 from public.hr_team_members t where t.organization_id='6013ed02-626a-497c-b951-619069035532'
 and (private.my_day_manager(t.organization_id) or private.my_day_assigned(t.id))
 and exists(select 1 from unnest(t.location_ids) l where private.my_day_access(t.organization_id,l))
$$;
create function public.my_day_save(p_kind text,p_id uuid,p_version integer,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; loc uuid; old_task public.my_day_tasks; old_proc public.my_day_procedures; old_data jsonb; new_data jsonb;
begin
 if p_id is null or p_version is null or p_version<0 or jsonb_typeof(p) is distinct from 'object' or p_kind is null or p_kind not in ('task','procedure','status') then raise exception 'Invalid record';end if;
 perform pg_advisory_xact_lock(hashtextextended('my-day:'||p_id,0));
 if p_kind='procedure' then
  select * into old_proc from public.my_day_procedures where id=p_id for update;
  if old_proc.id is not null and (old_proc.organization_id<>org or not private.my_day_access(org,old_proc.location_id,true)) then raise exception 'Access denied' using errcode='42501';end if;
  if coalesce(old_proc.version,0)<>p_version then raise exception 'Record changed. Refresh and retry.' using errcode='40001';end if;
  loc:=(p->>'location_id')::uuid;
 else
  select * into old_task from public.my_day_tasks where id=p_id for update;
  if old_task.id is not null and (old_task.organization_id<>org or not private.my_day_access(org,old_task.location_id,true)) then raise exception 'Access denied' using errcode='42501';end if;
  if coalesce(old_task.version,0)<>p_version then raise exception 'Record changed. Refresh and retry.' using errcode='40001';end if;
  loc:=case when p_kind='status' then old_task.location_id else (p->>'location_id')::uuid end;
 end if;
 if loc is null or not private.my_day_access(org,loc,true) or not exists(select 1 from public.locations where id=loc and organization_id=org) then raise exception 'Location access denied' using errcode='42501';end if;
 if p_kind='status' then
  if old_task.id is null or not (private.my_day_manager(org) or private.my_day_assigned(old_task.assignee_id)) then raise exception 'Task access denied' using errcode='42501';end if;
  if (select count(*) from jsonb_object_keys(p))<>1 or not p?'status' then raise exception 'Only task status can be changed';end if;
  update public.my_day_tasks set status=p->>'status',version=version+1,updated_at=now() where id=p_id returning to_jsonb(my_day_tasks.*) into new_data;old_data:=to_jsonb(old_task);
 else
  if not private.my_day_manager(org) then raise exception 'Manager access required' using errcode='42501';end if;
  if p_kind='task' then
   if not exists(select 1 from public.hr_team_members where id=(p->>'assignee_id')::uuid and organization_id=org and status='active' and loc=any(location_ids)) then raise exception 'Choose an active team member assigned to this location';end if;
   if nullif(p->>'procedure_id','') is not null and not exists(select 1 from public.my_day_procedures where id=(p->>'procedure_id')::uuid and organization_id=org and location_id=loc and status='published') then raise exception 'Choose a published procedure for this location';end if;
   insert into public.my_day_tasks(id,organization_id,location_id,title,description,due_date,priority,status,assignee_id,procedure_id)
   values(p_id,org,loc,trim(p->>'title'),coalesce(p->>'description',''),(p->>'due_date')::date,p->>'priority',p->>'status',(p->>'assignee_id')::uuid,nullif(p->>'procedure_id','')::uuid)
   on conflict(id) do update set location_id=excluded.location_id,title=excluded.title,description=excluded.description,due_date=excluded.due_date,priority=excluded.priority,status=excluded.status,assignee_id=excluded.assignee_id,procedure_id=excluded.procedure_id,version=my_day_tasks.version+1,updated_at=now()
   returning to_jsonb(my_day_tasks.*) into new_data;old_data:=to_jsonb(old_task);
  else
   if old_proc.id is not null and loc<>old_proc.location_id and exists(select 1 from public.my_day_tasks where procedure_id=p_id) then raise exception 'A linked procedure cannot move to another location';end if;
   insert into public.my_day_procedures(id,organization_id,location_id,title,purpose,steps,verification,status)
   values(p_id,org,loc,trim(p->>'title'),coalesce(p->>'purpose',''),p->>'steps',coalesce(p->>'verification',''),p->>'status')
   on conflict(id) do update set location_id=excluded.location_id,title=excluded.title,purpose=excluded.purpose,steps=excluded.steps,verification=excluded.verification,status=excluded.status,version=my_day_procedures.version+1,updated_at=now()
   returning to_jsonb(my_day_procedures.*) into new_data;old_data:=to_jsonb(old_proc);
  end if;
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,old_data,new_data) values(org,auth.uid(),'my-day.save',p_kind,p_id,old_data,new_data);
end $$;
revoke all on function public.my_day_team(),public.my_day_save(text,uuid,integer,jsonb) from public,anon;
grant execute on function public.my_day_team(),public.my_day_save(text,uuid,integer,jsonb) to authenticated;
create trigger hr_profile_write_guard before insert or update or delete on public.my_day_tasks for each row execute function private.hr_profile_write_guard('my-day');
create trigger hr_profile_write_guard before insert or update or delete on public.my_day_procedures for each row execute function private.hr_profile_write_guard('my-day');
-- Extend the existing validated profile editor without changing applied history.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.hr_save_profile(text,integer,jsonb)'::regprocedure);
 if position('''overview'',''hr''' in definition)=0 then raise exception 'Unexpected profile function definition';end if;
 execute replace(definition,'''overview'',''hr''','''overview'',''my-day'',''hr''');
end $$;
notify pgrst,'reload schema';
