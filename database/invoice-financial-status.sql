-- Financial presentation is separate from document approval and stock workflow.
alter table public.invoices add column payment_recorded_at timestamptz;
alter table public.purchase_receipts add column receiver_name text;
comment on column public.invoices.payment_recorded_at is 'When payment was recorded, not the inferred bank settlement date.';
comment on column public.purchase_receipts.receiver_name is 'Receiver name captured on completion. Legacy names intentionally not inferred.';

create function public.financial_status(public.invoices) returns text
language sql stable security invoker set search_path='' as $$
 select case when $1.status::text='cancelled' then 'cancelled'
 when $1.total<0 then 'credit'
 when $1.status::text='paid' then 'paid'
 when $1.due_date<(current_timestamp at time zone 'America/New_York')::date then 'overdue'
 else 'unpaid' end;
$$;
revoke all on function public.financial_status(public.invoices) from public,anon;
grant execute on function public.financial_status(public.invoices) to authenticated,service_role;

create function private.capture_invoice_payment() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status::text='paid' then
  if tg_op='INSERT' then new.payment_recorded_at=clock_timestamp();
  elsif old.status::text is distinct from 'paid' then new.payment_recorded_at=clock_timestamp();
  else new.payment_recorded_at=old.payment_recorded_at; end if;
 else new.payment_recorded_at=null; end if;
 return new;
end $$;
revoke all on function private.capture_invoice_payment() from public,anon;
create trigger invoices_capture_payment before insert or update on public.invoices
for each row execute function private.capture_invoice_payment();

-- The caller's existing receipt policies and completion workflow remain in force.
create function private.capture_receipt_receiver() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status::text='completed' and (tg_op='INSERT' or old.status::text is distinct from 'completed') then
  new.received_by=coalesce(auth.uid(),new.received_by);
  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''))
   into new.receiver_name from auth.users u left join public.profiles p on p.id=u.id where u.id=new.received_by;
 elsif tg_op='UPDATE' then new.receiver_name=old.receiver_name;
 else new.receiver_name=null; end if;
 return new;
end $$;
revoke all on function private.capture_receipt_receiver() from public,anon,authenticated;
create trigger purchase_receipts_capture_receiver before insert or update on public.purchase_receipts
for each row execute function private.capture_receipt_receiver();
notify pgrst,'reload schema';

-- Expose only receiver display names for receipts the signed-in finance user can access.
create or replace function private.invoice_receipt_receivers(p_organization_id uuid,p_receipt_ids uuid[])
returns table(receipt_id uuid,received_by_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.mfa_authorized()
  or not private.has_org_role(p_organization_id,array['owner','admin','manager']::public.member_role[]) then
  raise exception 'Receipt access denied.' using errcode='42501';
 end if;
 return query select r.id,r.receiver_name::text
 from public.purchase_receipts r
 join auth.users u on u.id=r.received_by
 left join public.profiles p on p.id=u.id
 where r.organization_id=p_organization_id and r.id=any(p_receipt_ids)
  and private.is_org_member(r.organization_id) and private.can_location(r.location_id) and private.can_supplier(r.supplier_id);
end $$;
revoke all on function private.invoice_receipt_receivers(uuid,uuid[]) from public,anon;
grant execute on function private.invoice_receipt_receivers(uuid,uuid[]) to authenticated;
create or replace function public.invoice_receipt_receivers(p_organization_id uuid,p_receipt_ids uuid[])
returns table(receipt_id uuid,received_by_name text)
language sql stable security invoker set search_path='' as $$
 select * from private.invoice_receipt_receivers(p_organization_id,p_receipt_ids);
$$;
revoke all on function public.invoice_receipt_receivers(uuid,uuid[]) from public,anon;
grant execute on function public.invoice_receipt_receivers(uuid,uuid[]) to authenticated;
