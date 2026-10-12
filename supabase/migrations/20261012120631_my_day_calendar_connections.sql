-- Individual read-only calendar subscriptions; incoming URL and token hash are not exposed as table rows.
create table private.my_day_calendar_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 organization_id uuid not null references public.organizations(id),
 icloud_url text, feed_hash text unique check(feed_hash ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz not null default now()
);
alter table private.my_day_calendar_connections enable row level security;
revoke all on private.my_day_calendar_connections from public,anon,authenticated;
create function private.my_day_calendar_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.mfa_authorized() and exists(
 select 1 from public.organization_members m left join public.hr_permission_profiles p on p.organization_id=m.organization_id and p.role=m.role::text
 where m.user_id=auth.uid() and m.organization_id='6013ed02-626a-497c-b951-619069035532' and m.status='active'
 and m.role::text in ('owner','admin','manager','chef','staff') and (m.role::text='owner' or coalesce(p.permissions->'my-day'->>'view','true')='true'))
$$;
revoke all on function private.my_day_calendar_allowed() from public,anon;
grant execute on function private.my_day_calendar_allowed() to authenticated;
create function public.my_day_calendar_config() returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.my_day_calendar_connections%rowtype;
begin
 if not private.my_day_calendar_allowed() then raise exception 'Calendar access denied' using errcode='42501';end if;
 select * into c from private.my_day_calendar_connections where user_id=auth.uid();
 return jsonb_build_object('icloud_url',c.icloud_url,'feed_enabled',c.feed_hash is not null);
end $$;
create function public.my_day_calendar_save(p_action text,p_value text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.my_day_calendar_allowed() then raise exception 'Calendar access denied' using errcode='42501';end if;
 if p_action not in ('connect','disconnect','rotate','revoke') or p_action is null then raise exception 'Invalid calendar action';end if;
 if p_action='connect' and (p_value is null or length(p_value)>2048 or p_value !~ '^https://p[0-9]+-caldav\.icloud\.com/published/[A-Za-z0-9/_-]+$') then raise exception 'Use a published iCloud calendar link';end if;
 if p_action='rotate' then
  if p_value is null or p_value !~ '^[a-f0-9]{64}$' or not exists(select 1 from public.hr_team_members t join public.organization_members m on m.id=t.member_id where t.organization_id='6013ed02-626a-497c-b951-619069035532' and m.user_id=auth.uid() and m.status='active' and t.status='active') then raise exception 'Your account must be linked to an active Team member';end if;
 end if;
 insert into private.my_day_calendar_connections(user_id,organization_id) values(auth.uid(),'6013ed02-626a-497c-b951-619069035532') on conflict(user_id) do nothing;
 update private.my_day_calendar_connections set icloud_url=case when p_action='connect' then p_value when p_action='disconnect' then null else icloud_url end,
 feed_hash=case when p_action='rotate' then p_value when p_action='revoke' then null else feed_hash end,updated_at=now() where user_id=auth.uid();
 return jsonb_build_object('saved',true);
end $$;
create function public.my_day_calendar_feed(p_hash text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due_date',t.due_date,'status',t.status,'updated_at',t.updated_at) order by t.due_date,t.id),'[]')
 from private.my_day_calendar_connections c
 join public.organization_members m on m.user_id=c.user_id and m.organization_id=c.organization_id and m.status='active'
 left join public.hr_permission_profiles p on p.organization_id=m.organization_id and p.role=m.role::text
 join public.hr_team_members person on person.member_id=m.id and person.organization_id=m.organization_id and person.status='active'
 join public.my_day_tasks t on t.assignee_id=person.id and t.organization_id=c.organization_id
 where c.feed_hash=p_hash and p_hash ~ '^[a-f0-9]{64}$' and m.role::text in ('owner','admin','manager','chef','staff')
 and (m.role::text='owner' or coalesce(p.permissions->'my-day'->>'view','true')='true') and t.location_id=any(person.location_ids)
 and (m.role::text in ('owner','admin') or exists(select 1 from public.member_location_access a where a.member_id=m.id and a.location_id=t.location_id))
$$;
revoke all on function public.my_day_calendar_config(),public.my_day_calendar_save(text,text),public.my_day_calendar_feed(text) from public,anon,authenticated;
grant execute on function public.my_day_calendar_config(),public.my_day_calendar_save(text,text) to authenticated;
-- The unpredictable bearer subscription is read-only and rechecks membership/profile on every request.
grant execute on function public.my_day_calendar_feed(text) to anon,authenticated;
notify pgrst,'reload schema';
