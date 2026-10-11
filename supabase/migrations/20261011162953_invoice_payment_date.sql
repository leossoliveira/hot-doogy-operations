-- Effective payment date is separate from the immutable recording timestamp.
alter table public.invoices add column payment_date date;
create function private.record_invoice_payment(p_invoice_id uuid,p_organization_id uuid,p_status public.invoice_status,p_expected_status public.invoice_status,p_expected_updated_at timestamptz,p_payment_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_payment_date is null or p_status is distinct from 'paid'::public.invoice_status or p_expected_status='paid' then
  raise exception 'Choose a payment date for an unpaid invoice.' using errcode='22023';
 end if;
 -- Existing function enforces authentication, MFA, tenant/location/supplier, version and S3 guards.
 result=private.update_invoice_status(p_invoice_id,p_organization_id,p_status,p_expected_status,p_expected_updated_at);
 update public.invoices set payment_date=p_payment_date where id=p_invoice_id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 select organization_id,location_id,auth.uid(),'invoice_payment_date_recorded','invoices',id,jsonb_build_object('payment_date',p_payment_date) from public.invoices where id=p_invoice_id;
 return result||jsonb_build_object('paymentDate',p_payment_date,'updatedAt',(select updated_at from public.invoices where id=p_invoice_id));
end $$;
revoke all on function private.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date) from public,anon;
grant execute on function private.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date) to authenticated;
create function public.record_invoice_payment(p_invoice_id uuid,p_organization_id uuid,p_status public.invoice_status,p_expected_status public.invoice_status,p_expected_updated_at timestamptz,p_payment_date date)
returns jsonb language sql security invoker set search_path='' as $$
 select private.record_invoice_payment(p_invoice_id,p_organization_id,p_status,p_expected_status,p_expected_updated_at,p_payment_date);
$$;
revoke all on function public.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date) from public,anon;
grant execute on function public.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date) to authenticated;
