-- Invoice-level receiving declaration only; no warehouse receipt or stock posting.
create function public.approve_invoice_review(p_invoice uuid,p_expected_updated_at timestamptz,p_payment_status text,p_payment_date date,p_payment_method text,p_receiving_status text,p_received_by text,p_received_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; declaration jsonb;
begin
 if p_receiving_status is null or p_receiving_status not in ('not_received','received') then raise exception 'Choose a receiving status';end if;
 if p_receiving_status='received' and (nullif(btrim(p_received_by),'') is null or length(btrim(p_received_by))>200 or p_received_date is null or p_received_date>(now() at time zone 'America/New_York')::date) then raise exception 'Enter the receiver and a valid receiving date';end if;
 -- The existing approval function locks and checks the draft version, MFA, role,
 -- tenant, location, supplier, original attachment and payment fields.
 result:=public.approve_invoice_draft_payment(p_invoice,p_expected_updated_at,p_payment_status,p_payment_date,p_payment_method);
 declaration:=jsonb_build_object('status',p_receiving_status,'receivedBy',case when p_receiving_status='received' then btrim(p_received_by) end,'receivedDate',case when p_receiving_status='received' then p_received_date end,'recordedBy',auth.uid(),'recordedAt',now());
 update public.invoices set extraction=coalesce(extraction,'{}'::jsonb)||jsonb_build_object('receiving',declaration) where id=p_invoice;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 select organization_id,location_id,auth.uid(),'invoice_receiving_declared','invoice',id,declaration from public.invoices where id=p_invoice;
 return result||jsonb_build_object('receiving',declaration);
end $$;
revoke all on function public.approve_invoice_review(uuid,timestamptz,text,date,text,text,text,date) from public,anon,service_role;
grant execute on function public.approve_invoice_review(uuid,timestamptz,text,date,text,text,text,date) to authenticated;

-- Preserve review inputs on recoverable drafts, including a failed final approval.
do $migration$
declare definition text;old_fragment text;new_fragment text;
begin
 old_fragment:=$old$jsonb_build_object('result',p_payload->'extraction','model',p_payload->>'model')$old$;
 new_fragment:=$new$jsonb_build_object('result',p_payload->'extraction','model',p_payload->>'model','reviewedFields',p_payload - 'items' - 'extraction' - 'sourceSha256')$new$;
 definition:=pg_get_functiondef('public.save_llm_invoice_draft(uuid,jsonb)'::regprocedure);
 if strpos(definition,old_fragment)=0 then raise exception 'Unexpected draft save implementation';end if;
 execute replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$jsonb_build_object('paymentTerms',p_payload->>'paymentTerms','shipToAddress',p_payload->>'shipToAddress')$old$;
 new_fragment:=$new$(p_payload - 'items' - 'extraction' - 'sourceSha256')$new$;
 definition:=pg_get_functiondef('public.edit_llm_invoice_draft(uuid,timestamp with time zone,jsonb)'::regprocedure);
 if strpos(definition,old_fragment)=0 then raise exception 'Unexpected draft edit implementation';end if;
 execute replace(definition,old_fragment,new_fragment);
end $migration$;
