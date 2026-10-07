create or replace function private.is_invoice_document_canonical_path(object_name text)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_parts text[]; v_extension text; v_organization_id uuid; v_invoice_id uuid;
  v_invoice_number text; v_invoice_date date; v_location_name text; v_expected_file text;
begin
  v_parts := string_to_array(object_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 then return false; end if;
  v_extension := lower(regexp_replace(v_parts[3], '^.*\\.', ''));
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

create or replace function public.invoice_document_upload_path(target_invoice_id uuid, file_extension text)
returns text language plpgsql security invoker set search_path = '' as $function$
declare v_invoice public.invoices%rowtype; v_location_name text; v_extension text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  v_extension := lower(trim(leading '.' from file_extension));
  if v_extension not in ('pdf', 'jpg', 'jpeg', 'png', 'webp') then raise exception 'Unsupported file extension'; end if;
  select i.* into v_invoice from public.invoices i where i.id = target_invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  select l.name into v_location_name from public.locations l where l.id = v_invoice.location_id;
  if not private.is_org_member(v_invoice.organization_id) or not private.can_location(v_invoice.location_id) or not private.can_supplier(v_invoice.supplier_id) or not private.has_org_role(v_invoice.organization_id, array['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role]) then raise exception 'You are not allowed to upload a document for this invoice'; end if;
  return format('%s/%s/invoice-%s--%s--%s.%s', v_invoice.organization_id, v_invoice.id, trim(both '-' from regexp_replace(lower(coalesce(v_invoice.invoice_number, 'unassigned')), '[^a-z0-9]+', '-', 'g')), trim(both '-' from regexp_replace(lower(v_location_name), '[^a-z0-9]+', '-', 'g')), to_char(v_invoice.invoice_date, 'YYYYMMDD'), v_extension);
end;
$function$;
revoke all on function public.invoice_document_upload_path(uuid, text) from public;
grant execute on function public.invoice_document_upload_path(uuid, text) to authenticated;
;
