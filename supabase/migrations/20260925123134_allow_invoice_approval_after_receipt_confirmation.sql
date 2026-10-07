begin;

do $migration$
declare
  v_definition text;
  v_old text := $$if v_receipt.status not in ('draft', 'receiving') then raise exception 'The linked receipt must be draft or receiving'; end if;$$;
  v_new text := $$if v_receipt.status not in ('draft', 'receiving', 'completed') then raise exception 'The linked receipt must be draft, receiving, or completed'; end if;$$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'approve_invoice'
    and pg_get_function_identity_arguments(p.oid) = 'target_invoice_id uuid';

  if v_definition is null then
    raise exception 'public.approve_invoice(uuid) was not found';
  end if;

  if strpos(v_definition, v_old) = 0 then
    raise exception 'The expected receipt-status guard was not found in public.approve_invoice(uuid)';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

comment on function public.approve_invoice(uuid) is
  'Approves an invoice and remains compatible with receipts whose inventory was posted during receiving confirmation.';

commit;
;
