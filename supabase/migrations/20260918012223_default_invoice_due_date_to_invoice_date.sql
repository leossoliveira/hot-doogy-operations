alter table public.invoices
  alter column invoice_date set not null;

create or replace function private.default_invoice_due_date()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.due_date is null then
    new.due_date := new.invoice_date;
  end if;

  return new;
end;
$function$;

drop trigger if exists invoices_default_due_date on public.invoices;
create trigger invoices_default_due_date
before insert or update of invoice_date, due_date on public.invoices
for each row
execute function private.default_invoice_due_date();
;
