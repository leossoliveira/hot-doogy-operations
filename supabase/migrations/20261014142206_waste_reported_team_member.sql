-- Waste "Reported by" points to a Team Member. App users are linked through their login; automations (OpenClaw)
-- only send a name, which links when it equals one active team member's full name at that location, or else
-- exactly one active team member's first name there. Linked records show the team member's full name.
alter table public.waste_events add column if not exists reported_team_member_id uuid references public.hr_team_members(id) on delete set null;
create index if not exists waste_events_reported_team_member_idx on public.waste_events(reported_team_member_id);

create or replace function private.waste_link_team_member() returns trigger language plpgsql security definer set search_path='' as $$
declare member_row public.hr_team_members; wanted text:=lower(btrim(coalesce(new.reported_by_name,'')));
begin
 if new.reported_team_member_id is not null and (tg_op='INSERT' or new.reported_team_member_id is distinct from old.reported_team_member_id) then
  select * into member_row from public.hr_team_members where id=new.reported_team_member_id and organization_id=new.organization_id;
 elsif new.reported_by is not null then
  select tm.* into member_row from public.hr_team_members tm join public.organization_members om on om.id=tm.member_id
   where om.user_id=new.reported_by and om.organization_id=new.organization_id and tm.organization_id=new.organization_id and tm.status='active' limit 1;
 elsif wanted<>'' then
  select tm.* into member_row from public.hr_team_members tm where tm.organization_id=new.organization_id and tm.status='active' and new.location_id=any(tm.location_ids)
   and lower(btrim(concat_ws(' ',tm.first_name,tm.last_name)))=wanted and (select count(*) from public.hr_team_members x where x.organization_id=new.organization_id and x.status='active' and new.location_id=any(x.location_ids) and lower(btrim(concat_ws(' ',x.first_name,x.last_name)))=wanted)=1;
  if member_row.id is null then
   select tm.* into member_row from public.hr_team_members tm where tm.organization_id=new.organization_id and tm.status='active' and new.location_id=any(tm.location_ids)
    and lower(btrim(tm.first_name))=wanted and (select count(*) from public.hr_team_members x where x.organization_id=new.organization_id and x.status='active' and new.location_id=any(x.location_ids) and lower(btrim(x.first_name))=wanted)=1;
  end if;
 end if;
 if member_row.id is not null then
  new.reported_team_member_id:=member_row.id;
  new.reported_by_name:=coalesce(nullif(btrim(concat_ws(' ',member_row.first_name,member_row.last_name)),''),new.reported_by_name);
 elsif tg_op='UPDATE' and new.reported_team_member_id is not distinct from old.reported_team_member_id then
  new.reported_team_member_id:=null;
 end if;
 return new;
end $$;
revoke all on function private.waste_link_team_member() from public,anon,authenticated;

drop trigger if exists waste_link_team_member on public.waste_events;
create trigger waste_link_team_member before insert or update of reported_by,reported_by_name,reported_team_member_id,location_id on public.waste_events
 for each row execute function private.waste_link_team_member();

-- Link existing records.
update public.waste_events set reported_by_name=reported_by_name where reported_team_member_id is null;
notify pgrst,'reload schema';
