-- Keep the requesting employee's name on each internal request, taken from the signed-in user at creation.
alter table public.internal_requests add column requested_by_name text;

create or replace function private.internal_request_requester_name(p_org uuid,p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),'') from public.hr_team_members t join public.organization_members m on m.id=t.member_id where m.user_id=p_user and m.organization_id=p_org and nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),'') is not null order by t.status='active' desc limit 1),
  (select nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name')),'') from auth.users u where u.id=p_user),
  (select u.email from auth.users u where u.id=p_user));
$$;
revoke all on function private.internal_request_requester_name(uuid,uuid) from public,anon,authenticated;

create or replace function private.internal_request_set_requester_name() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.created_by is not null then new.requested_by_name:=private.internal_request_requester_name(new.organization_id,new.created_by); end if;
 return new;
end $$;
revoke all on function private.internal_request_set_requester_name() from public,anon,authenticated;
create trigger internal_request_requester_name before insert on public.internal_requests for each row execute function private.internal_request_set_requester_name();

update public.internal_requests set requested_by_name=private.internal_request_requester_name(organization_id,created_by) where created_by is not null and requested_by_name is null;
notify pgrst,'reload schema';
-- Rollback: redeploy the previous app, drop trigger internal_request_requester_name, both private functions
-- and the requested_by_name column.
