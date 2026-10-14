-- Prep batches recorded from the app take the signed-in user's registered name as preparer, the same
-- resolution used for internal request requesters: HR team member linked to the account, then the
-- profile name, then the account email. The app reads the name through operations_current_preparer().
create or replace function public.operations_current_preparer() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';member_row public.hr_team_members;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef','staff']::public.member_role[]) then raise exception 'Access denied' using errcode='42501';end if;
 select tm.* into member_row from public.hr_team_members tm join public.organization_members om on om.id=tm.member_id
  where om.user_id=auth.uid() and om.organization_id=org and tm.status='active' and nullif(btrim(concat_ws(' ',tm.first_name,tm.last_name)),'') is not null limit 1;
 return jsonb_build_object('teamMemberId',member_row.id,'name',private.internal_request_requester_name(org,auth.uid()),'locations',coalesce(to_jsonb(member_row.location_ids),'[]'::jsonb));
end $$;
revoke all on function public.operations_current_preparer() from public,anon;
grant execute on function public.operations_current_preparer() to authenticated;

-- Completed batches without an explicit team member assignment keep the recording user's name.
create or replace function private.prep_batch_set_preparer() returns trigger language plpgsql security definer set search_path='' as $$
declare member_row public.hr_team_members;
begin
 if new.status='completed' and new.prepared_by is not null and nullif(btrim(coalesce(new.prepared_team_member_name,'')),'') is null then
  select tm.* into member_row from public.hr_team_members tm join public.organization_members om on om.id=tm.member_id
   where om.user_id=new.prepared_by and om.organization_id=new.organization_id and tm.status='active' and new.location_id=any(tm.location_ids) and nullif(btrim(concat_ws(' ',tm.first_name,tm.last_name)),'') is not null limit 1;
  new.prepared_team_member_id:=member_row.id;
  new.prepared_team_member_name:=private.internal_request_requester_name(new.organization_id,new.prepared_by);
  new.prepared_assignment_version:=coalesce(new.prepared_assignment_version,0)+1;
 end if;
 return new;
end $$;
revoke all on function private.prep_batch_set_preparer() from public,anon,authenticated;
create trigger prep_batch_preparer before insert or update of status on public.prep_batches for each row execute function private.prep_batch_set_preparer();
notify pgrst,'reload schema';
-- Rollback: redeploy the previous app, drop trigger prep_batch_preparer on public.prep_batches,
-- drop function private.prep_batch_set_preparer() and drop function public.operations_current_preparer().
