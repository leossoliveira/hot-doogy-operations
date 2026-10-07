alter table public.invoices
  alter column due_date set not null;

alter table public.invoices
  add constraint invoices_due_date_not_before_invoice_date
  check (invoice_date is null or due_date >= invoice_date);

create index if not exists invoices_organization_location_due_date_idx
  on public.invoices (organization_id, location_id, due_date);
;
