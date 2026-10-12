-- Application capability overrides only narrow the existing system role.
create table public.hr_permission_profiles(
 organization_id uuid not null references public.organizations(id),
 role text not null check(role in ('admin','manager','chef','staff','employee','viewer')),
 permissions jsonb not null default '{}',version integer not null default 1,
 updated_at timestamptz not null default now(),primary key(organization_id,role)
);
alter table public.hr_permission_profiles enable row level security;
revoke all on public.hr_permission_profiles from public,anon,authenticated;
grant select on public.hr_permission_profiles to authenticated;
create policy hr_profiles_read on public.hr_permission_profiles for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=hr_permission_profiles.organization_id and m.user_id=auth.uid() and m.status='active') and private.mfa_authorized());
create function public.hr_save_profile(p_role text,p_version integer,p_permissions jsonb) returns void language plpgsql security definer set search_path='' as $$
declare org uuid:='6013ed02-626a-497c-b951-619069035532'; old public.hr_permission_profiles; k text; v jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin']::public.member_role[]) then raise exception 'Profile access denied' using errcode='42501';end if;
 if exists(select 1 from public.hr_permission_profiles p join public.organization_members m on m.organization_id=p.organization_id and m.role::text=p.role where m.user_id=auth.uid() and m.organization_id=org and (p.permissions->'hr'->>'view'='false' or p.permissions->'hr'->>'write'='false')) then raise exception 'Profile editing denied' using errcode='42501';end if;
 if p_role='admin' and not private.has_org_role(org,array['owner']::public.member_role[]) then raise exception 'Only an owner can edit Administrator' using errcode='42501';end if;
 if p_role not in ('admin','manager','chef','staff','employee','viewer') or p_role is null or p_version is null or jsonb_typeof(p_permissions) is distinct from 'object' then raise exception 'Invalid profile';end if;
 for k,v in select * from jsonb_each(p_permissions) loop
  if k not in ('overview','hr','preparation','inventory','transfers','waste','purchasing','recipes','food-cost','doogy-ai','reports','settings') or jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'view') is distinct from 'boolean' or jsonb_typeof(v->'write') is distinct from 'boolean' or (v->>'write')::boolean and not (v->>'view')::boolean then raise exception 'Invalid profile permission';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('hr-profile:'||org||':'||p_role,0));
 select * into old from public.hr_permission_profiles where organization_id=org and role=p_role for update;
 if coalesce(old.version,0)<>p_version then raise exception 'Profile changed. Reload and retry.' using errcode='40001';end if;
 insert into public.hr_permission_profiles(organization_id,role,permissions) values(org,p_role,p_permissions)
 on conflict(organization_id,role) do update set permissions=excluded.permissions,version=hr_permission_profiles.version+1,updated_at=now();
 insert into public.audit_logs(organization_id,user_id,action,entity_type,old_data,new_data) values(org,auth.uid(),'hr.profile.save','hr_permission_profiles',to_jsonb(old),jsonb_build_object('role',p_role,'permissions',p_permissions));
end $$;
revoke all on function public.hr_save_profile(text,integer,jsonb) from public,anon;
grant execute on function public.hr_save_profile(text,integer,jsonb) to authenticated;
-- Write restrictions also cover direct Data API writes and SECURITY DEFINER RPCs.
create function private.hr_profile_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare settings jsonb;
begin
 if auth.uid() is not null then
  select p.permissions into settings from public.organization_members m join public.hr_permission_profiles p on p.organization_id=m.organization_id and p.role=m.role::text where m.user_id=auth.uid() and m.organization_id='6013ed02-626a-497c-b951-619069035532' and m.status='active';
  if settings->tg_argv[0]->>'view'='false' or settings->tg_argv[0]->>'write'='false' then raise exception 'Your permission profile does not allow saving changes in this module.' using errcode='42501';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function private.hr_profile_write_guard() from public,anon,authenticated;
do $$ declare r record; module text;begin
 for r in select tablename from pg_tables where schemaname='public' and tablename not in ('hr_permission_profiles','audit_logs','organizations','profiles','organization_members','member_location_access','member_storage_area_access','member_supplier_access') loop
 module:=case
 when r.tablename like 'hr_%' then 'hr'
 when r.tablename like 'purchase_%' or r.tablename like 'invoice%' or r.tablename like 'supplier%' then 'purchasing'
 when r.tablename like 'recipe%' or r.tablename in ('modifiers','menu_item_modifier_rules') then 'recipes'
 when r.tablename like 'prep_%' then 'preparation'
 when r.tablename like 'interstore_%' or r.tablename like 'internal_request%' or r.tablename like 'inventory_transfer%' then 'transfers'
 when r.tablename like 'waste_%' then 'waste'
 when r.tablename like 'ai_%' then 'doogy-ai'
 when r.tablename like 'sales_%' or r.tablename like 'pos_%' or r.tablename in ('location_settings','departments') then 'settings'
 else 'inventory' end;
 execute format('create trigger hr_profile_write_guard before insert or update or delete on public.%I for each row execute function private.hr_profile_write_guard(%L)',r.tablename,module);
 end loop;
end $$;
notify pgrst,'reload schema';
