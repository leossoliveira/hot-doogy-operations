create or replace function private.is_invoice_document_canonical_path(object_name text)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_parts text[]; v_extension text; v_organization_id uuid; v_invoice_id uuid;
  v_invoice_number text; v_invoice_date date; v_location_name text; v_expected_file text;
begin
  v_parts := string_to_array(object_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 then return false; end if;
  v_extension := lower(regexp_replace(v_parts[3], '^.*[.]', ''));
  if v_extension not in ('pdf', 'jpg', 'jpeg', 'png', 'webp') then return false; end if;
  begin v_organization_id := v_parts[1]::uuid; v_invoice_id := v_parts[2]::uuid;
  exception when invalid_text_representation then return false; end;
  select i.invoice_number, i.invoice_date, l.name into v_invoice_number, v_invoice_date, v_location_name
  from public.invoices i join public.locations l on l.id = i.location_id
  where i.id = v_invoice_id and i.organization_id = v_organization_id;
  if not found then return false; end if;
  v_expected_file := format('invoice-%s--%s--%s.%s', trim(both '-' from regexp_replace(lower(coalesce(v_invoice_number, 'unassigned')), '[^a-z0-9]+', '-', 'g')), trim(both '-' from regexp_replace(lower(v_location_name), '[^a-z0-9]+', '-', 'g')), to_char(v_invoice_date, 'YYYYMMDD'), v_extension);
  return v_parts[3] = v_expected_file;
end;
$function$;
revoke all on function private.is_invoice_document_canonical_path(text) from public;
;
