-- Optional local wall-clock schedule, interpreted in America/New_York.
-- Existing tasks remain all-day on due_date until a schedule is supplied.
alter table public.my_day_tasks add column starts_at timestamp, add column ends_at timestamp,
 add constraint my_day_event_interval check ((starts_at is null and ends_at is null) or
 (starts_at is not null and ends_at is not null and ends_at>starts_at and ends_at<=starts_at+interval '366 days'
 and starts_at>=timestamp '2000-01-01' and ends_at<timestamp '2101-01-01'
 and (starts_at at time zone 'America/New_York') at time zone 'America/New_York'=starts_at
 and (ends_at at time zone 'America/New_York') at time zone 'America/New_York'=ends_at));
create or replace function public.my_day_save(p_kind text,p_id uuid,p_version integer,p jsonb) returns void language plpgsql security definer set search_path='' as $$
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
   insert into public.my_day_tasks(id,organization_id,location_id,title,description,due_date,priority,status,assignee_id,procedure_id,starts_at,ends_at)
   values(p_id,org,loc,trim(p->>'title'),coalesce(p->>'description',''),(p->>'due_date')::date,p->>'priority',p->>'status',(p->>'assignee_id')::uuid,nullif(p->>'procedure_id','')::uuid,case when p?'starts_at' then nullif(p->>'starts_at','')::timestamp else old_task.starts_at end,case when p?'ends_at' then nullif(p->>'ends_at','')::timestamp else old_task.ends_at end)
   on conflict(id) do update set location_id=excluded.location_id,title=excluded.title,description=excluded.description,due_date=excluded.due_date,priority=excluded.priority,status=excluded.status,assignee_id=excluded.assignee_id,procedure_id=excluded.procedure_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,version=my_day_tasks.version+1,updated_at=now()
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
create or replace function public.my_day_create_series(p_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';start_date date;until_date date;due date;month_start date;rule text;n integer:=0;created integer:=0;task_id uuid;loc uuid;
begin
 if p_id is null or jsonb_typeof(p) is distinct from 'object' then raise exception 'Invalid recurring task';end if;
 loc:=(p->>'location_id')::uuid;
 if loc is null or not private.my_day_access(org,loc,true) or not private.my_day_manager(org) then raise exception 'Recurring task access denied' using errcode='42501';end if;
 rule:=p->>'recurrence_rule';start_date:=(p->>'due_date')::date;until_date:=(p->>'recurrence_until')::date;
 if rule is null or rule not in ('daily','weekdays','weekly','monthly') or start_date is null or until_date is null or until_date<=start_date or until_date>start_date+365 then raise exception 'Choose a recurrence end after the first due date, within one year';end if;
 perform pg_advisory_xact_lock(hashtextextended('my-day-series:'||p_id,0));
 if exists(select 1 from public.my_day_tasks where id=p_id or recurrence_id=p_id) then raise exception 'This recurring task was already created. Refresh to see it.' using errcode='40001';end if;
 due:=start_date;
 while due<=until_date loop
  if rule<>'weekdays' or extract(isodow from due) between 1 and 5 then
   task_id:=case when created=0 then p_id else gen_random_uuid() end;
   perform public.my_day_save('task',task_id,0,p||jsonb_build_object('due_date',due,'status','todo','starts_at',nullif(p->>'starts_at','')::timestamp+(due-start_date)*interval '1 day','ends_at',nullif(p->>'ends_at','')::timestamp+(due-start_date)*interval '1 day'));
   update public.my_day_tasks set recurrence_id=p_id,recurrence_rule=rule,recurrence_until=until_date where id=task_id;
   created:=created+1;
  end if;
  n:=n+1;
  if rule='monthly' then
   month_start:=(date_trunc('month',start_date)+(n||' months')::interval)::date;
   due:=month_start+(least(extract(day from start_date)::int,extract(day from (month_start+interval '1 month - 1 day'))::int)-1);
  else due:=start_date+n*(case when rule='weekly' then 7 else 1 end);end if;
 end loop;
 if created<2 then raise exception 'Choose an end date that includes at least two occurrences';end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,new_data) values(org,auth.uid(),'my-day.series.create','my_day_tasks',p_id,jsonb_build_object('rule',rule,'start',start_date,'until',until_date,'occurrences',created));
 return jsonb_build_object('created',created,'recurrence_id',p_id);
end $$;
create or replace function private.my_day_calendar_feed(p_hash text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due_date',t.due_date,'starts_at',t.starts_at at time zone 'America/New_York','ends_at',t.ends_at at time zone 'America/New_York','status',t.status,'updated_at',t.updated_at) order by t.due_date,t.id),'[]')
 from private.my_day_calendar_connections c
 join public.organization_members m on m.user_id=c.user_id and m.organization_id=c.organization_id and m.status='active'
 left join public.hr_permission_profiles p on p.organization_id=m.organization_id and p.role=m.role::text
 join public.hr_team_members person on person.member_id=m.id and person.organization_id=m.organization_id and person.status='active'
 join public.my_day_tasks t on t.assignee_id=person.id and t.organization_id=c.organization_id
 where c.feed_hash=p_hash and p_hash ~ '^[a-f0-9]{64}$' and m.role::text in ('owner','admin','manager','chef','staff')
 and (m.role::text='owner' or coalesce(p.permissions->'my-day'->>'view','true')='true') and t.location_id=any(person.location_ids)
 and (m.role::text in ('owner','admin') or exists(select 1 from public.member_location_access a where a.member_id=m.id and a.location_id=t.location_id))
$$;
notify pgrst,'reload schema';
