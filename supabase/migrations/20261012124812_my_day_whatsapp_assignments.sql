-- Explicit per-person opt-in; no existing team member is opted in automatically.
alter table public.hr_team_members add column whatsapp_task_notifications boolean not null default false,
 add constraint hr_whatsapp_phone_required check(not whatsapp_task_notifications or phone ~ '^\+[1-9][0-9]{6,14}$');
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.hr_save(text,uuid,integer,jsonb)'::regprocedure);
 if position('phone_country,email,status' in definition)=0 then raise exception 'Unexpected HR save definition';end if;
 definition:=replace(definition,'phone_country,email,status','phone_country,whatsapp_task_notifications,email,status');
 definition:=replace(definition,'nullif(p->>''phone_country'','''')','nullif(p->>''phone_country'',''''),case when p?''whatsapp_task_notifications'' then (p->>''whatsapp_task_notifications'')::boolean else coalesce(old_emp.whatsapp_task_notifications,false) end');
 definition:=replace(definition,'phone_country=excluded.phone_country,email=','phone_country=excluded.phone_country,whatsapp_task_notifications=excluded.whatsapp_task_notifications,email=');
 execute definition;
end $$;
create table private.my_day_whatsapp_outbox(
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.my_day_tasks(id),
 task_version integer not null, assignee_id uuid not null references public.hr_team_members(id), actor_id uuid not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','unconfirmed','cancelled','grouped')),
 claim_id uuid, message_id text, created_at timestamptz not null default now(), finished_at timestamptz,
 unique(task_id,task_version)
);
alter table private.my_day_whatsapp_outbox enable row level security;
revoke all on private.my_day_whatsapp_outbox from public,anon,authenticated;
create index my_day_whatsapp_pending on private.my_day_whatsapp_outbox(actor_id,created_at) where state='pending';
create function private.enqueue_my_day_whatsapp() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new;end if;
 if tg_op='UPDATE' and new.assignee_id=old.assignee_id then return new;end if;
 if exists(select 1 from public.hr_team_members p where p.id=new.assignee_id and p.organization_id=new.organization_id and p.status='active' and p.whatsapp_task_notifications and p.phone ~ '^\+[1-9][0-9]{6,14}$') then
  insert into private.my_day_whatsapp_outbox(task_id,task_version,assignee_id,actor_id) values(new.id,new.version,new.assignee_id,auth.uid()) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.enqueue_my_day_whatsapp() from public,anon,authenticated;
create trigger my_day_whatsapp_assignment after insert or update of assignee_id on public.my_day_tasks for each row execute function private.enqueue_my_day_whatsapp();
-- Only the assigning manager can claim their own pending notifications. No arbitrary recipient or text is accepted.
create function public.my_day_whatsapp_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';q private.my_day_whatsapp_outbox;t public.my_day_tasks;person public.hr_team_members;batch uuid:=gen_random_uuid();n integer:=1;last_due date;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.my_day_manager(org) then raise exception 'Task notification access denied' using errcode='42501';end if;
 for q in select * from private.my_day_whatsapp_outbox where actor_id=auth.uid() and state='pending' order by created_at,id for update skip locked limit 400 loop
  select * into t from public.my_day_tasks where id=q.task_id;
  select * into person from public.hr_team_members where id=q.assignee_id;
  if exists(select 1 from private.my_day_whatsapp_outbox newer where newer.task_id=q.task_id and newer.task_version>q.task_version) or t.organization_id is distinct from org or not private.my_day_access(org,t.location_id,true) or t.assignee_id<>q.assignee_id or t.status='done' or person.status<>'active' or not person.whatsapp_task_notifications or person.phone !~ '^\+[1-9][0-9]{6,14}$' or not t.location_id=any(person.location_ids) then
   update private.my_day_whatsapp_outbox set state='cancelled',finished_at=now() where id=q.id;continue;
  end if;
  if q.task_version=1 and t.recurrence_id is not null then
   update private.my_day_whatsapp_outbox o set state='grouped',claim_id=batch where o.actor_id=auth.uid() and o.state='pending' and o.task_version=1 and o.assignee_id=q.assignee_id and o.task_id in(select id from public.my_day_tasks where recurrence_id=t.recurrence_id and assignee_id=q.assignee_id);
   get diagnostics n=row_count;
   select max(due_date) into last_due from public.my_day_tasks where recurrence_id=t.recurrence_id;
  end if;
  update private.my_day_whatsapp_outbox set state='sending',claim_id=batch where id=q.id;
  return jsonb_build_object('id',q.id,'claim_id',batch,'phone',person.phone,'name',concat_ws(' ',person.first_name,person.last_name),'title',t.title,'scope',left(t.description,900),'due_date',t.due_date,'starts_at',t.starts_at,'ends_at',t.ends_at,'location',(select name from public.locations where id=t.location_id),'occurrences',greatest(n,1),'last_due',last_due);
 end loop;
 return null;
end $$;
create function public.my_day_whatsapp_finish(p_id uuid,p_claim uuid,p_message_id text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.my_day_manager('6013ed02-626a-497c-b951-619069035532') then raise exception 'Task notification access denied' using errcode='42501';end if;
 update private.my_day_whatsapp_outbox set state=case when nullif(p_message_id,'') is not null then 'sent' else 'unconfirmed' end,message_id=left(p_message_id,256),finished_at=now()
 where actor_id=auth.uid() and claim_id=p_claim and state in ('sending','grouped') and exists(select 1 from private.my_day_whatsapp_outbox where id=p_id and claim_id=p_claim and actor_id=auth.uid());
end $$;
create function public.my_day_whatsapp_status() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('task_id',o.task_id,'state',case when o.state='sending' and o.created_at<now()-interval '2 minutes' then 'unconfirmed' else o.state end)),'[]')
 from private.my_day_whatsapp_outbox o join public.my_day_tasks t on t.id=o.task_id
 where o.actor_id=auth.uid() and private.mfa_authorized() and private.my_day_manager(t.organization_id) and private.my_day_access(t.organization_id,t.location_id,true)
 and o.task_version=(select max(x.task_version) from private.my_day_whatsapp_outbox x where x.task_id=o.task_id);
$$;
revoke all on function public.my_day_whatsapp_claim(),public.my_day_whatsapp_finish(uuid,uuid,text),public.my_day_whatsapp_status() from public,anon;
grant execute on function public.my_day_whatsapp_claim(),public.my_day_whatsapp_finish(uuid,uuid,text),public.my_day_whatsapp_status() to authenticated;
notify pgrst,'reload schema';
