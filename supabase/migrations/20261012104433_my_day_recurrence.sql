-- Finite recurring schedules create independent, editable task occurrences atomically.
alter table public.my_day_tasks add column recurrence_id uuid,
 add column recurrence_rule text check(recurrence_rule in ('daily','weekdays','weekly','monthly')),
 add column recurrence_until date,
 add constraint my_day_recurrence_complete check((recurrence_id is null and recurrence_rule is null and recurrence_until is null) or (recurrence_id is not null and recurrence_rule is not null and recurrence_until is not null));
create index my_day_tasks_recurrence on public.my_day_tasks(recurrence_id) where recurrence_id is not null;
create function public.my_day_create_series(p_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
   perform public.my_day_save('task',task_id,0,p||jsonb_build_object('due_date',due,'status','todo'));
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
revoke all on function public.my_day_create_series(uuid,jsonb) from public,anon;
grant execute on function public.my_day_create_series(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
