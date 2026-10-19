-- Draft state is separate from stock: only submitted sections create observations.
create table public.inventory_count_sessions (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 location_id uuid not null references public.locations(id),
 created_by uuid not null references auth.users(id),
 employee_name text not null,
 status text not null default 'draft' check(status in ('draft','completed')),
 state jsonb not null,
 published jsonb not null default '{}',
 version integer not null default 1,
 last_request uuid not null,
 last_payload jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz
);
create index inventory_count_sessions_location on public.inventory_count_sessions(organization_id,location_id,status);
alter table public.inventory_count_sessions enable row level security;
revoke all on public.inventory_count_sessions from public,anon,authenticated;
grant select on public.inventory_count_sessions to authenticated;
create policy inventory_count_sessions_read on public.inventory_count_sessions for select to authenticated
 using(organization_id='6013ed02-626a-497c-b951-619069035532'::uuid and private.mfa_authorized()
 and private.has_org_role(organization_id,array['owner','admin','manager','chef','staff']::public.member_role[]) and private.can_location(location_id));

create or replace function public.save_inventory_count(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 org uuid:='6013ed02-626a-497c-b951-619069035532';actor uuid:=auth.uid();
 rec public.inventory_count_sessions; sid uuid:=(p->>'id')::uuid;request_id uuid:=(p->>'requestId')::uuid;
 action text:=p->>'action';snapshot jsonb:=p->'state';loc uuid:=(p->>'locationId')::uuid;
 line jsonb;previous jsonb;section_name text;section_lines jsonb;signature jsonb;identity_before jsonb;identity_after jsonb;
 counter jsonb;stamp timestamptz:=clock_timestamp();offset_minutes integer:=(p->>'countOffsetMinutes')::integer;count_day date;
 qty numeric;
begin
 if actor is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef','staff']::public.member_role[]) then raise exception 'Access denied' using errcode='42501';end if;
 if sid is null or request_id is null or action is null or action not in ('save','section','complete') then raise exception 'Invalid count request';end if;
 if not private.can_location(loc) or not exists(select 1 from public.locations where id=loc and organization_id=org) then raise exception 'Location not authorized' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory-count:'||sid::text,0));
 select * into rec from public.inventory_count_sessions where id=sid for update;
 if found then
  if rec.organization_id<>org or rec.location_id<>loc or rec.created_by<>actor then raise exception 'Only the count creator can resume this draft' using errcode='42501';end if;
  if rec.last_request=request_id then
   if rec.last_payload<>p then raise exception 'Count request was changed';end if;
   return to_jsonb(rec)-'last_payload';
  end if;
  if rec.status<>'draft' then raise exception 'This count is already completed';end if;
  if rec.version is distinct from (p->>'expectedVersion')::integer then raise exception 'Count changed in another window. Reopen it from History.' using errcode='40001';end if;
 else
  if action<>'save' or (p->>'expectedVersion')::integer is distinct from 0 then raise exception 'Count draft not found';end if;
 end if;
 if jsonb_typeof(snapshot) is distinct from 'object' or jsonb_typeof(snapshot->'lines') is distinct from 'array' or jsonb_array_length(snapshot->'lines') not between 1 and 500 or pg_column_size(snapshot)>500000 then raise exception 'Invalid count draft';end if;
 if jsonb_typeof(snapshot->'notes') is distinct from 'string' or length(snapshot->>'notes')>4000 then raise exception 'Invalid count notes';end if;
 select jsonb_agg(jsonb_build_array(x->>'rowId',x->>'itemId',x->>'section') order by x->>'rowId') into identity_after from jsonb_array_elements(snapshot->'lines') x;
 if rec.id is not null then
  select jsonb_agg(jsonb_build_array(x->>'rowId',x->>'itemId',x->>'section') order by x->>'rowId') into identity_before from jsonb_array_elements(rec.state->'lines') x;
  if identity_before<>identity_after then raise exception 'The items and sections of a started count cannot change';end if;
 end if;
 if (select count(distinct x->>'rowId') from jsonb_array_elements(snapshot->'lines') x)<>jsonb_array_length(snapshot->'lines') or (select count(distinct x->>'itemId') from jsonb_array_elements(snapshot->'lines') x)<>jsonb_array_length(snapshot->'lines') then raise exception 'Duplicate count items';end if;
 for line in select value from jsonb_array_elements(snapshot->'lines') loop
  qty:=coalesce(nullif(line->>'qty','')::numeric,0);
  if qty<0 or qty>100000000 or qty::text in ('NaN','Infinity','-Infinity') or nullif(line->>'rowId','') is null or nullif(line->>'section','') is null or length(line->>'section')>250 or length(coalesce(line->>'issue',''))>2000 then raise exception 'Invalid count item';end if;
  if not exists(select 1 from public.inventory_item_units u join public.location_inventory_items li on li.inventory_item_id=u.inventory_item_id where u.id=(line->>'itemUnitId')::uuid and u.inventory_item_id=(line->>'itemId')::uuid and u.organization_id=org and u.is_count_unit and u.quantity_in_base_unit>0 and li.location_id=loc and li.active and li.id=(line->>'rowId')::uuid) then raise exception 'Invalid count item or unit';end if;
 end loop;
 if rec.id is null then
  if exists(select 1 from public.store_count_observations where session_id=sid) or exists(select 1 from public.stock_counts where id=sid) then raise exception 'Count identity already exists';end if;
  counter:=public.operations_current_preparer();
  insert into public.inventory_count_sessions(id,organization_id,location_id,created_by,employee_name,state,last_request,last_payload)
   values(sid,org,loc,actor,counter->>'name',snapshot,request_id,p) returning * into rec;
 else
  rec.state:=snapshot;
 end if;
 if action in ('section','complete') then
  if offset_minutes is null or offset_minutes not between -840 and 840 then raise exception 'Invalid count timezone';end if;
  count_day:=((stamp at time zone 'UTC')-offset_minutes*interval '1 minute')::date;
  if action='section' and not exists(select 1 from jsonb_array_elements(snapshot->'lines') x where x->>'section'=p->>'section') then raise exception 'Section not found';end if;
  for section_name in select distinct x->>'section' from jsonb_array_elements(snapshot->'lines') x where action='complete' or x->>'section'=p->>'section' loop
   select jsonb_agg(jsonb_build_object('itemId',x->>'itemId','itemUnitId',x->>'itemUnitId','qty',coalesce(nullif(x->>'qty','')::numeric,0)) order by x->>'rowId') into section_lines from jsonb_array_elements(snapshot->'lines') x where x->>'section'=section_name;
   signature:=section_lines;
   if rec.published->section_name is distinct from signature then
    -- Replace only this count's previous observations for these items. Other counts stay intact.
    delete from public.store_count_observations o where o.organization_id=org and o.location_id=loc and o.session_id=sid and o.inventory_item_id in(select (x->>'itemId')::uuid from jsonb_array_elements(section_lines) x);
    perform private.web_operation('counts',jsonb_build_object('id',sid,'locationId',loc,'employeeName',left(rec.employee_name,80),'date',count_day,'countedAt',stamp,'countOffsetMinutes',offset_minutes,'notes',snapshot->>'notes','lines',section_lines,'issues',coalesce((select jsonb_agg(jsonb_build_object('itemId',x->>'itemId','text',x->>'issue')) from jsonb_array_elements(snapshot->'lines') x where nullif(btrim(x->>'issue'),'') is not null),'[]'::jsonb)));
    rec.published:=jsonb_set(rec.published,array[section_name],signature);
   end if;
  end loop;
 end if;
 update public.inventory_count_sessions set state=snapshot,published=rec.published,status=case when action='complete' then 'completed' else 'draft' end,completed_at=case when action='complete' then stamp else null end,version=case when rec.last_request=request_id then rec.version else rec.version+1 end,last_request=request_id,last_payload=p,updated_at=stamp where id=sid returning * into rec;
 return to_jsonb(rec)-'last_payload';
end $$;
revoke all on function public.save_inventory_count(jsonb) from public,anon;
grant execute on function public.save_inventory_count(jsonb) to authenticated;
notify pgrst,'reload schema';
-- Rollback: revert the app first. Preserve the session table and observations for audit/recovery.
