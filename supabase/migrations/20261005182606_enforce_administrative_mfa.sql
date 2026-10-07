-- Stage locally. Apply together with the MFA-capable application release.
-- Existing owner/admin password-only sessions lose data access immediately.
begin;
create or replace function private.auth_session_active()
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists (
  select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
  and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())
 );
$$;
create or replace function private.auth_mfa_verified()
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce(auth.jwt()->>'aal'='aal2',false) and exists (
  select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
  where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
  and s.aal='aal2' and f.status='verified' and (s.not_after is null or s.not_after>now())
 );
$$;
create or replace function private.mfa_authorized()
returns boolean language sql stable security definer set search_path = '' as $$
 select private.auth_session_active() and (
  private.auth_mfa_verified() or (
   not exists(select 1 from public.organization_members m where m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin'))
   and not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified')
  )
 );
$$;
create or replace function private.operations_auth_status()
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('active',private.auth_session_active(),'mfa_verified',private.auth_mfa_verified(),'allowed',private.mfa_authorized());
$$;
create or replace function public.operations_auth_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
 select private.operations_auth_status();
$$;
revoke all on function private.auth_session_active(), private.auth_mfa_verified(), private.mfa_authorized(), private.operations_auth_status(), public.operations_auth_status() from public,anon,authenticated;
grant execute on function private.mfa_authorized(),private.operations_auth_status(),public.operations_auth_status() to authenticated;

-- Restrictive policies AND with existing ownership/scope policies; never grant access.
-- Own membership is the only pre-MFA business read, used to bootstrap enrollment.
do $$
declare t record;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
 loop
  if t.nspname='public' and t.relname='organization_members' then
   execute 'drop policy if exists mfa_membership_read on public.organization_members';
   execute 'create policy mfa_membership_read on public.organization_members as restrictive for select to authenticated using (user_id=(select auth.uid()) or (select private.mfa_authorized()))';
   execute 'drop policy if exists mfa_membership_insert on public.organization_members';
   execute 'create policy mfa_membership_insert on public.organization_members as restrictive for insert to authenticated with check ((select private.mfa_authorized()))';
   execute 'drop policy if exists mfa_membership_update on public.organization_members';
   execute 'create policy mfa_membership_update on public.organization_members as restrictive for update to authenticated using ((select private.mfa_authorized())) with check ((select private.mfa_authorized()))';
   execute 'drop policy if exists mfa_membership_delete on public.organization_members';
   execute 'create policy mfa_membership_delete on public.organization_members as restrictive for delete to authenticated using ((select private.mfa_authorized()))';
  else
   execute format('drop policy if exists mfa_required on %I.%I',t.nspname,t.relname);
   execute format('create policy mfa_required on %I.%I as restrictive for all to authenticated using ((select private.mfa_authorized())) with check ((select private.mfa_authorized()))',t.nspname,t.relname);
  end if;
 end loop;
end $$;

-- Security-definer RPCs use these helpers before reading or changing business data.
-- Existing organization/location/supplier checks with the MFA gate added.
-- Preserve each existing scope predicate; add the MFA requirement.
CREATE OR REPLACE FUNCTION private.is_org_member(target_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  select private.mfa_authorized() and exists (

    select 1

    from public.organization_members m

    where
      m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'

  );

$function$;

CREATE OR REPLACE FUNCTION private.has_org_role(target_org uuid, allowed_roles public.member_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  select private.mfa_authorized() and exists (

    select 1

    from public.organization_members m

    where
      m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(allowed_roles)

  );

$function$;

CREATE OR REPLACE FUNCTION private.can_location(target_location uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT private.mfa_authorized() AND EXISTS (
  SELECT 1 FROM public.locations l JOIN public.organization_members m ON m.organization_id=l.organization_id
  WHERE l.id=target_location AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND (m.role IN ('owner','admin') OR EXISTS (
    SELECT 1 FROM public.member_location_access a WHERE a.member_id=m.id AND a.location_id=l.id))
 );
$function$;

CREATE OR REPLACE FUNCTION private.can_storage(target_storage uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT private.mfa_authorized() AND EXISTS (
  SELECT 1 FROM public.storage_areas s JOIN public.organization_members m ON m.organization_id=s.organization_id
  WHERE s.id=target_storage AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND private.can_location(s.location_id)
  AND (m.role IN ('owner','admin','manager','chef') OR EXISTS (
   SELECT 1 FROM public.member_storage_area_access a WHERE a.member_id=m.id AND a.storage_area_id=s.id AND a.can_view))
 );
$function$;

CREATE OR REPLACE FUNCTION private.can_supplier(target_supplier uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT private.mfa_authorized() AND EXISTS (
  SELECT 1 FROM public.suppliers s JOIN public.organization_members m ON m.organization_id=s.organization_id
  WHERE s.id=target_supplier AND m.user_id=(SELECT auth.uid()) AND m.status='active'
  AND (m.role IN ('owner','admin','manager') OR EXISTS (
   SELECT 1 FROM public.member_supplier_access a WHERE a.member_id=m.id AND a.supplier_id=s.id AND a.can_view))
 );
$function$;


revoke all on function private.is_org_member(uuid),private.has_org_role(uuid,public.member_role[]),private.can_location(uuid),private.can_storage(uuid),private.can_supplier(uuid) from public,anon;
grant execute on function private.is_org_member(uuid),private.has_org_role(uuid,public.member_role[]),private.can_location(uuid),private.can_storage(uuid),private.can_supplier(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

;
