alter table public.invoices add column payment_method text check(payment_method in ('credit_card','debit_card','bank_transfer'));
create function private.record_invoice_payment(p_invoice_id uuid,p_organization_id uuid,p_status public.invoice_status,p_expected_status public.invoice_status,p_expected_updated_at timestamptz,p_payment_date date,p_payment_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_payment_method is not null and p_payment_method not in ('credit_card','debit_card','bank_transfer') then
 raise exception 'Choose a valid payment method.' using errcode='22023'; end if;
 result=private.record_invoice_payment(p_invoice_id,p_organization_id,p_status,p_expected_status,p_expected_updated_at,p_payment_date);
 update public.invoices set payment_method=p_payment_method where id=p_invoice_id;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data)
 select organization_id,location_id,auth.uid(),'invoice_payment_method_recorded','invoices',id,jsonb_build_object('payment_method',p_payment_method) from public.invoices where id=p_invoice_id;
 return result||jsonb_build_object('paymentMethod',p_payment_method,'updatedAt',(select updated_at from public.invoices where id=p_invoice_id));
end $$;
revoke all on function private.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date,text) from public,anon;
grant execute on function private.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date,text) to authenticated;
create function public.record_invoice_payment(p_invoice_id uuid,p_organization_id uuid,p_status public.invoice_status,p_expected_status public.invoice_status,p_expected_updated_at timestamptz,p_payment_date date,p_payment_method text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.record_invoice_payment(p_invoice_id,p_organization_id,p_status,p_expected_status,p_expected_updated_at,p_payment_date,p_payment_method);
$$;
revoke all on function public.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date,text) from public,anon;
grant execute on function public.record_invoice_payment(uuid,uuid,public.invoice_status,public.invoice_status,timestamptz,date,text) to authenticated;
