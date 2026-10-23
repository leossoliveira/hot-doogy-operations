-- Operational screens need sales totals and change detection, not every sale.
-- All aggregation runs with the caller's existing RLS and MFA checks.
create function public.workspace_sales_summary(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.mfa_authorized() or not private.is_org_member(p_organization_id) then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
 if private.is_operations_staff() then return jsonb_build_object('daily','[]'::jsonb,'signature','staff');end if;
 with facts as materialized (
  select * from public.sales_item_facts where organization_id=p_organization_id
 ), daily as (
  select fact_date date,location_id "locationId",sum(quantity) quantity,sum(net_sales) "netSales",
   sum(gross_sales) "grossSales",sum(discounts) discounts,count(*) "factCount"
  from facts group by fact_date,location_id
 )
 select jsonb_build_object('daily',coalesce((select jsonb_agg(to_jsonb(daily) order by date,"locationId") from daily),'[]'::jsonb),
  'signature',(select md5(coalesce(string_agg(md5(to_jsonb(facts)::text),'' order by id),'')) from facts)) into result;
 return result;
end $$;
revoke all on function public.workspace_sales_summary(uuid) from public,anon;
grant execute on function public.workspace_sales_summary(uuid) to authenticated;
notify pgrst,'reload schema';
