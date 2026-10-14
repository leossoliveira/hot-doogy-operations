-- Supplying store reports an approved item that will not be sent; the item closes at the quantity already shipped.
create table public.internal_request_line_issues (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 request_id uuid not null references public.internal_requests(id),
 request_line_id uuid not null references public.internal_request_lines(id),
 issue_type text not null check(issue_type in ('not_sent')),
 quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index internal_request_line_issues_request_idx on public.internal_request_line_issues(request_id);
create index internal_request_line_issues_line_idx on public.internal_request_line_issues(request_line_id);
alter table public.internal_request_line_issues enable row level security;
create policy request_line_issues_read on public.internal_request_line_issues for select to authenticated using(exists(select 1 from public.internal_requests r where r.id=request_id));
revoke all on public.internal_request_line_issues from public,anon,authenticated;
grant select on public.internal_request_line_issues to authenticated;
grant all on public.internal_request_line_issues to service_role;

create or replace function private.report_internal_request_line_not_sent(p_request uuid,p_organization uuid,p_line uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.internal_requests; ln public.internal_request_lines; sent numeric; remaining numeric; issue uuid;
begin
 select * into req from public.internal_requests where id=p_request and organization_id=p_organization for update;
 if req.id is null then raise exception 'Transfer not found';end if;
 perform private.internal_request_authorize(req.organization_id,req.fulfilling_location_id);
 if req.status not in ('approved','in_progress') then raise exception 'Only transfers in production can report unsent items. Reload before saving.' using errcode='40001';end if;
 if nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>1000 then raise exception 'Enter a reason up to 1000 characters';end if;
 select * into ln from public.internal_request_lines where id=p_line and request_id=req.id for update;
 if ln.id is null then raise exception 'Transfer item not found';end if;
 select coalesce(sum(quantity),0) into sent from public.interstore_transfer_lines where request_line_id=ln.id;
 remaining:=coalesce(ln.approved_quantity,0)-sent;
 if remaining<=0 then raise exception 'This item has nothing left to send. Reload before saving.' using errcode='40001';end if;
 update public.internal_request_lines set approved_quantity=sent where id=ln.id;
 insert into public.internal_request_line_issues(organization_id,request_id,request_line_id,issue_type,quantity,reason,created_by)
 values(req.organization_id,req.id,ln.id,'not_sent',remaining,btrim(p_reason),auth.uid()) returning id into issue;
 -- With nothing left to send or receive, the transfer closes as a partial receipt.
 if not exists(
  select 1 from public.internal_request_lines r where r.request_id=req.id and coalesce(r.approved_quantity,0)>
   (select coalesce(sum(rl.quantity),0) from public.interstore_receipt_lines rl join public.interstore_transfer_lines tl on tl.id=rl.transfer_line_id where tl.request_line_id=r.id)
 ) then update public.internal_requests set status='closed_partial' where id=req.id; end if;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data) values(req.organization_id,req.fulfilling_location_id,auth.uid(),'internal_request_line_not_sent','internal_request_lines',ln.id,jsonb_build_object('approved_quantity',ln.approved_quantity,'status',req.status),jsonb_build_object('approved_quantity',sent,'unsent_quantity',remaining,'reason',btrim(p_reason),'issue_id',issue));
 return jsonb_build_object('id',issue,'saved',true);
end $$;
revoke all on function private.report_internal_request_line_not_sent(uuid,uuid,uuid,text) from public,anon;
grant execute on function private.report_internal_request_line_not_sent(uuid,uuid,uuid,text) to authenticated;
create function public.report_internal_request_line_not_sent(p_request uuid,p_organization uuid,p_line uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$select private.report_internal_request_line_not_sent(p_request,p_organization,p_line,p_reason);$$;
revoke all on function public.report_internal_request_line_not_sent(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.report_internal_request_line_not_sent(uuid,uuid,uuid,text) to authenticated;
-- Editing follows the same two-step verification rule as the other transfer steps.
create or replace function private.edit_internal_request(p_request uuid,p_organization uuid,p_lines jsonb,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.internal_requests; x jsonb; qty numeric; item uuid; selected_unit uuid; factor numeric; item_name text; before_lines jsonb; kept uuid[]:='{}';
begin
 select * into req from public.internal_requests where id=p_request and organization_id=p_organization for update;
 if req.id is null or auth.uid() is null or not private.mfa_authorized() or not coalesce(private.is_org_member(req.organization_id)
  and private.has_org_role(req.organization_id,array['owner','admin','manager','chef']::public.member_role[])
  and (private.can_location(req.requesting_location_id) or private.can_location(req.fulfilling_location_id)),false)
 then raise exception 'Transfer access denied' using errcode='42501';end if;
 if req.status<>'submitted' then raise exception 'Only requested transfers can be edited. Reload before saving.' using errcode='40001';end if;
 if p_notes is not null and length(p_notes)>4000 then raise exception 'Enter notes up to 4000 characters';end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'Expected 1 to 200 items';end if;
 if (select count(distinct value->>'itemId') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Each item can appear only once';end if;
 select jsonb_agg(to_jsonb(l) order by l.id) into before_lines from public.internal_request_lines l where request_id=req.id;
 for x in select value from jsonb_array_elements(p_lines) loop
  item:=(x->>'itemId')::uuid;selected_unit:=(x->>'itemUnitId')::uuid;qty:=(x->>'quantity')::numeric;
  if qty is null or qty<=0 or qty>100000000 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid quantity';end if;
  select quantity_in_base_unit into factor from public.inventory_item_units where id=selected_unit and inventory_item_id=item and organization_id=req.organization_id;
  select internal_name into item_name from public.inventory_items where id=item and organization_id=req.organization_id and active;
  if factor is null or item_name is null
   or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=req.requesting_location_id and active)
   or not exists(select 1 from public.location_inventory_items where inventory_item_id=item and location_id=req.fulfilling_location_id and active)
  then raise exception 'Item/unit must be active and enabled in both stores';end if;
  -- Existing items keep their line identity; new items get a new line.
  update public.internal_request_lines set item_unit_id=selected_unit,unit_factor=factor,requested_quantity=qty,approved_quantity=null
   where request_id=req.id and inventory_item_id=item;
  if not found then
   insert into public.internal_request_lines(request_id,inventory_item_id,item_unit_id,unit_factor,requested_quantity,internal_name_snapshot)
   values(req.id,item,selected_unit,factor,qty,item_name);
  end if;
  kept:=kept||item;
 end loop;
 delete from public.internal_request_lines where request_id=req.id and not (inventory_item_id=any(kept));
 update public.internal_requests set notes=nullif(btrim(p_notes),'') where id=req.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,old_data,new_data) values(req.organization_id,auth.uid(),'internal_request_edited','internal_requests',req.id,jsonb_build_object('notes',req.notes,'lines',before_lines),jsonb_build_object('notes',nullif(btrim(p_notes),''),'lines',p_lines));
 return jsonb_build_object('id',req.id,'saved',true);
end $$;
notify pgrst,'reload schema';
-- Rollback: redeploy the previous app, then drop both report_internal_request_line_not_sent functions and
-- public.internal_request_line_issues. Reported items keep their reduced approved quantity.
