-- Persist source fingerprints, not uploaded reports; serialize imports per organization.
create table public.hr_workday_imports(
 organization_id uuid not null references public.organizations(id),source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 imported_by uuid not null,created_at timestamptz not null default now(),row_count integer not null,primary key(organization_id,source_sha256));
alter table public.hr_workday_imports enable row level security;
revoke all on public.hr_workday_imports from public,anon,authenticated;
create function public.hr_import_workdays(p_source text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';r jsonb;emp public.hr_team_members;n integer:=0;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'HR access denied' using errcode='42501';end if;
 if p_source is null or p_source !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Invalid import';end if;
 perform pg_advisory_xact_lock(hashtextextended('hr_import:'||org,0));
 if exists(select 1 from public.hr_workday_imports where organization_id=org and source_sha256=p_source) then return jsonb_build_object('alreadyImported',true,'imported',0);end if;
 -- Sorted employee locks avoid deadlocks and coordinate with manual workday saves.
 for r in select value from jsonb_array_elements(p_rows) order by value->>'team_member_id',value->>'work_date' loop
  select * into emp from public.hr_team_members where id=(r->>'team_member_id')::uuid and organization_id=org for update;
  if emp.id is null or emp.version is distinct from (r->>'team_version')::integer then raise exception 'Team member changed. Reopen the import review.';end if;
  if (r->>'total_hours')::numeric is null or (r->>'total_hours')::numeric<=0 or (r->>'total_hours')::numeric>24 then raise exception 'Enter valid daily hours';end if;
  if exists(select 1 from public.hr_workdays where team_member_id=emp.id and location_id=(r->>'location_id')::uuid and work_date=(r->>'work_date')::date and status<>'void') then raise exception 'Hours already exist for this person, date and location. No rows were imported.';end if;
  perform public.hr_save('workday',gen_random_uuid(),0,jsonb_build_object('team_member_id',emp.id,'location_id',r->>'location_id','work_date',r->>'work_date','regular_hours',r->>'total_hours','overtime_hours',0,'status','approved'));
  n:=n+1;
 end loop;
 insert into public.hr_workday_imports(organization_id,source_sha256,imported_by,row_count) values(org,p_source,auth.uid(),n);
 return jsonb_build_object('imported',n);
end $$;
revoke all on function public.hr_import_workdays(text,jsonb) from public,anon;
grant execute on function public.hr_import_workdays(text,jsonb) to authenticated;
-- Minimal directory: no email, phone, rates or account data exposed to operations.
create function public.operations_team_directory(p_module text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532';result jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or p_module is null or p_module not in ('purchasing','preparation') or not private.has_org_role(org,array['owner','admin','manager','chef','staff']::public.member_role[]) then raise exception 'Access denied' using errcode='42501';end if;
 if p_module='purchasing' and not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) then raise exception 'Access denied' using errcode='42501';end if;
 if exists(select 1 from public.hr_permission_profiles p join public.organization_members m on m.organization_id=p.organization_id and m.role::text=p.role where m.user_id=auth.uid() and m.organization_id=org and p.permissions->p_module->>'view'='false') then raise exception 'Profile access denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',btrim(concat_ws(' ',t.first_name,t.last_name)),'locations',array(select l from unnest(t.location_ids) l where private.can_location(l))) order by t.first_name,t.last_name),'[]') into result
 from public.hr_team_members t where t.organization_id=org and t.status='active' and nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),'') is not null and exists(select 1 from unnest(t.location_ids) l where private.can_location(l));
 return result;
end $$;
revoke all on function public.operations_team_directory(text) from public,anon;
grant execute on function public.operations_team_directory(text) to authenticated;
create function public.set_invoice_team_receiver(p_invoice uuid,p_expected_updated_at timestamptz,p_team uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.invoices;emp public.hr_team_members;old_receiving jsonb;declaration jsonb;
begin
 select * into inv from public.invoices where id=p_invoice for update;
 if inv.id is null or auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(inv.organization_id,array['owner','admin','manager']::public.member_role[]) or not private.can_location(inv.location_id) or not private.can_supplier(inv.supplier_id) then raise exception 'Invoice access denied' using errcode='42501';end if;
 if inv.updated_at is distinct from p_expected_updated_at then raise exception 'Invoice changed. Reload and retry.';end if;
 old_receiving:=inv.extraction->'receiving';
 if old_receiving->>'status' is distinct from 'received' then raise exception 'Record receiving before assigning a receiver';end if;
 select * into emp from public.hr_team_members where id=p_team and organization_id=inv.organization_id and status='active' and inv.location_id=any(location_ids) for share;
 if emp.id is null or nullif(btrim(concat_ws(' ',emp.first_name,emp.last_name)),'') is null then raise exception 'Choose an active team member assigned to this location';end if;
 declaration:=old_receiving||jsonb_build_object('teamMemberId',emp.id,'receivedBy',btrim(concat_ws(' ',emp.first_name,emp.last_name)),'recordedBy',auth.uid(),'recordedAt',now());
 update public.invoices set extraction=extraction||jsonb_build_object('receiving',declaration) where id=inv.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data) values(inv.organization_id,inv.location_id,auth.uid(),'invoice_receiver_assigned','invoice',inv.id,old_receiving,declaration);
 return declaration;
end $$;
revoke all on function public.set_invoice_team_receiver(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.set_invoice_team_receiver(uuid,timestamptz,uuid) to authenticated;
create function public.approve_invoice_team_review(p_invoice uuid,p_expected_updated_at timestamptz,p_payment_status text,p_payment_date date,p_payment_method text,p_receiving_status text,p_team uuid,p_received_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;inv public.invoices;emp public.hr_team_members;
begin
 if p_receiving_status='received' then
  select * into inv from public.invoices where id=p_invoice for update;
  select * into emp from public.hr_team_members where id=p_team and organization_id=inv.organization_id and status='active' and inv.location_id=any(location_ids) for share;
  if emp.id is null or nullif(btrim(concat_ws(' ',emp.first_name,emp.last_name)),'') is null then raise exception 'Choose an active team member assigned to this location';end if;
 end if;
 result:=public.approve_invoice_review(p_invoice,p_expected_updated_at,p_payment_status,p_payment_date,p_payment_method,p_receiving_status,btrim(concat_ws(' ',emp.first_name,emp.last_name)),p_received_date);
 if p_receiving_status='received' then
  update public.invoices set extraction=jsonb_set(extraction,'{receiving,teamMemberId}',to_jsonb(emp.id)) where id=p_invoice;
 end if;
 return result;
end $$;
revoke all on function public.approve_invoice_team_review(uuid,timestamptz,text,date,text,text,uuid,date) from public,anon;
grant execute on function public.approve_invoice_team_review(uuid,timestamptz,text,date,text,text,uuid,date) to authenticated;
notify pgrst,'reload schema';
-- Keep prepared_by as the authenticated recorder; a separate FK identifies the actual preparer.
alter table public.prep_batches add column prepared_team_member_id uuid references public.hr_team_members(id),add column prepared_team_member_name text,add column prepared_assignment_version integer not null default 0;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if position('elsif p_action=''invoices'' then' in definition)=0 then raise exception 'Unexpected operation definition';end if;
 definition:=replace(definition,'elsif p_action=''invoices'' then',$patch$
 if p->>'status'='completed' and nullif(p->>'preparedTeamMemberId','') is not null then
  if not exists(select 1 from public.hr_team_members t where t.id=(p->>'preparedTeamMemberId')::uuid and t.organization_id=org and t.status='active' and loc=any(t.location_ids) and nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),'') is not null) then raise exception 'Choose an active team member assigned to this location';end if;
  update public.prep_batches b set prepared_assignment_version=prepared_assignment_version+1,prepared_team_member_id=t.id,prepared_team_member_name=btrim(concat_ws(' ',t.first_name,t.last_name)) from public.hr_team_members t where b.id=id and t.id=(p->>'preparedTeamMemberId')::uuid;
 end if;
 elsif p_action='invoices' then$patch$);
 execute definition;
end $$;
create function public.set_prep_team_member(p_batch uuid,p_expected_version integer,p_team uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.prep_batches;t public.hr_team_members;
begin
 select * into b from public.prep_batches where id=p_batch for update;
 if b.id is null or auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(b.organization_id,array['owner','admin','manager','chef']::public.member_role[]) or not private.can_location(b.location_id) then raise exception 'Prep access denied' using errcode='42501';end if;
 if b.prepared_assignment_version is distinct from p_expected_version then raise exception 'Batch changed. Reload and retry.';end if;
 select * into t from public.hr_team_members where id=p_team and organization_id=b.organization_id and status='active' and b.location_id=any(location_ids) for share;
 if t.id is null or nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),'') is null then raise exception 'Choose an active team member assigned to this location';end if;
 update public.prep_batches set prepared_assignment_version=prepared_assignment_version+1,prepared_team_member_id=t.id,prepared_team_member_name=btrim(concat_ws(' ',t.first_name,t.last_name)) where id=b.id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data) values(b.organization_id,b.location_id,auth.uid(),'prep_preparer_assigned','prep_batch',b.id,jsonb_build_object('teamMemberId',b.prepared_team_member_id,'name',b.prepared_team_member_name),jsonb_build_object('teamMemberId',t.id,'name',btrim(concat_ws(' ',t.first_name,t.last_name))));
end $$;
revoke all on function public.set_prep_team_member(uuid,integer,uuid) from public,anon;
grant execute on function public.set_prep_team_member(uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
