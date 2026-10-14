-- Report only part of an item as not sent (e.g. 2 bags requested, 1 sent): the rest stays open for shipment.
drop function public.report_internal_request_line_not_sent(uuid,uuid,uuid,text);
drop function private.report_internal_request_line_not_sent(uuid,uuid,uuid,text);
create or replace function private.report_internal_request_line_not_sent(p_request uuid,p_organization uuid,p_line uuid,p_reason text,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.internal_requests; ln public.internal_request_lines; sent numeric; remaining numeric; unsent numeric; issue uuid;
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
 -- Without a quantity the whole remaining balance is reported, as in the first version.
 unsent:=coalesce(p_quantity,remaining);
 if unsent<=0 or unsent>remaining or unsent::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a quantity not sent greater than 0 and up to %',remaining;end if;
 if round(unsent*ln.unit_factor,6)<>unsent*ln.unit_factor then raise exception 'Quantity must be representable in base units to six decimals';end if;
 update public.internal_request_lines set approved_quantity=ln.approved_quantity-unsent where id=ln.id;
 insert into public.internal_request_line_issues(organization_id,request_id,request_line_id,issue_type,quantity,reason,created_by)
 values(req.organization_id,req.id,ln.id,'not_sent',unsent,btrim(p_reason),auth.uid()) returning id into issue;
 -- With nothing left to send or receive, the transfer closes as a partial receipt.
 if not exists(
  select 1 from public.internal_request_lines r where r.request_id=req.id and coalesce(r.approved_quantity,0)>
   (select coalesce(sum(rl.quantity),0) from public.interstore_receipt_lines rl join public.interstore_transfer_lines tl on tl.id=rl.transfer_line_id where tl.request_line_id=r.id)
 ) then update public.internal_requests set status='closed_partial' where id=req.id; end if;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,old_data,new_data) values(req.organization_id,req.fulfilling_location_id,auth.uid(),'internal_request_line_not_sent','internal_request_lines',ln.id,jsonb_build_object('approved_quantity',ln.approved_quantity,'status',req.status),jsonb_build_object('approved_quantity',ln.approved_quantity-unsent,'unsent_quantity',unsent,'reason',btrim(p_reason),'issue_id',issue));
 return jsonb_build_object('id',issue,'saved',true);
end $$;
revoke all on function private.report_internal_request_line_not_sent(uuid,uuid,uuid,text,numeric) from public,anon;
grant execute on function private.report_internal_request_line_not_sent(uuid,uuid,uuid,text,numeric) to authenticated;
create function public.report_internal_request_line_not_sent(p_request uuid,p_organization uuid,p_line uuid,p_reason text,p_quantity numeric)
returns jsonb language sql security invoker set search_path='' as $$select private.report_internal_request_line_not_sent(p_request,p_organization,p_line,p_reason,p_quantity);$$;
revoke all on function public.report_internal_request_line_not_sent(uuid,uuid,uuid,text,numeric) from public,anon;
grant execute on function public.report_internal_request_line_not_sent(uuid,uuid,uuid,text,numeric) to authenticated;
notify pgrst,'reload schema';
-- Rollback: redeploy the previous app, drop the five-argument functions and recreate the four-argument
-- versions from 20261014021028_internal_request_line_not_sent_issues.sql.
