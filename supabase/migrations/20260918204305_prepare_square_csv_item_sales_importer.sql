
-- Private bucket for original Square CSV reports.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-imports',
  'sales-imports',
  false,
  20971520,
  array['text/csv','application/csv','application/vnd.ms-excel','text/plain']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- A stable link from each resulting fact to its source CSV row makes processing idempotent.
alter table public.sales_item_facts
  add column if not exists source_row_id uuid references public.sales_import_rows(id) on delete cascade;

create unique index if not exists sales_item_facts_source_row_id_key
  on public.sales_item_facts(source_row_id)
  where source_row_id is not null;

-- CSV-specific item-name rule. API integrations must not use this function.
create or replace function private.square_csv_resolved_item_name(
  p_item text,
  p_price_point_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_price_point_name, '')), '') is null
      or lower(btrim(p_price_point_name)) = 'regular'
      then nullif(btrim(p_item), '')
    else nullif(btrim(p_price_point_name), '')
  end
$$;

create or replace function private.square_csv_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
begin
  v_clean := regexp_replace(coalesce(p_value, ''), '[^0-9.()\-]', '', 'g');
  if v_clean = '' then
    return null;
  end if;
  if v_clean ~ '^\(.*\)$' then
    v_clean := '-' || trim(both '()' from v_clean);
  end if;
  return v_clean::numeric;
exception when others then
  return null;
end;
$$;

create or replace function private.square_csv_timestamp(
  p_date text,
  p_time text,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_date date;
  v_time time;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    return null;
  end if;

  if coalesce(p_date, '') ~ '^\d{2}/\d{2}/\d{4}$' then
    v_date := to_date(p_date, 'MM/DD/YYYY');
  elsif coalesce(p_date, '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_date := p_date::date;
  else
    return null;
  end if;

  begin
    if upper(coalesce(p_time, '')) ~ '(AM|PM)$' then
      v_time := to_timestamp(upper(btrim(p_time)), 'HH12:MI:SS AM')::time;
    else
      v_time := btrim(p_time)::time;
    end if;
  exception when others then
    return null;
  end;

  return (v_date + v_time) at time zone p_timezone;
exception when others then
  return null;
end;
$$;

create or replace function private.prepare_square_csv_import_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_location_id uuid;
  v_location_name text;
  v_timezone text;
  v_item text;
  v_price_point text;
  v_resolved_name text;
  v_sku text;
  v_qty numeric;
  v_gross numeric;
  v_discounts numeric;
  v_net numeric;
  v_occurred_at timestamptz;
  v_menu_item_id uuid;
  v_errors text[] := array[]::text[];
begin
  select b.organization_id, b.location_id, l.name, l.timezone
    into v_org_id, v_location_id, v_location_name, v_timezone
  from public.sales_import_batches b
  join public.locations l on l.id = b.location_id
  where b.id = new.batch_id;

  if v_location_id is null then
    raise exception 'Invalid sales import batch';
  end if;

  -- Retain only the fields approved for Square CSV imports.
  new.raw_data := jsonb_strip_nulls(jsonb_build_object(
    'Date', new.raw_data->>'Date',
    'Time', new.raw_data->>'Time',
    'Time Zone', new.raw_data->>'Time Zone',
    'Item', new.raw_data->>'Item',
    'Qty', new.raw_data->>'Qty',
    'Price Point Name', new.raw_data->>'Price Point Name',
    'SKU', new.raw_data->>'SKU',
    'Gross Sales', new.raw_data->>'Gross Sales',
    'Discounts', new.raw_data->>'Discounts',
    'Net Sales', new.raw_data->>'Net Sales',
    'Location', new.raw_data->>'Location',
    'Dining Option', new.raw_data->>'Dining Option',
    'Channel', new.raw_data->>'Channel'
  ));

  v_item := nullif(btrim(new.raw_data->>'Item'), '');
  v_price_point := nullif(btrim(new.raw_data->>'Price Point Name'), '');
  v_resolved_name := private.square_csv_resolved_item_name(v_item, v_price_point);
  v_sku := nullif(btrim(new.raw_data->>'SKU'), '');
  v_qty := private.square_csv_numeric(new.raw_data->>'Qty');
  v_gross := private.square_csv_numeric(new.raw_data->>'Gross Sales');
  v_discounts := private.square_csv_numeric(new.raw_data->>'Discounts');
  v_net := private.square_csv_numeric(new.raw_data->>'Net Sales');
  v_occurred_at := private.square_csv_timestamp(
    new.raw_data->>'Date',
    new.raw_data->>'Time',
    v_timezone
  );

  if nullif(btrim(new.raw_data->>'Location'), '') is null
     or lower(btrim(new.raw_data->>'Location')) <> lower(v_location_name) then
    v_errors := array_append(v_errors, 'Location does not match the import batch');
  end if;
  if v_occurred_at is null then
    v_errors := array_append(v_errors, 'Invalid Date or Time');
  end if;
  if v_resolved_name is null then
    v_errors := array_append(v_errors, 'Item or Price Point Name is required');
  end if;
  if v_qty is null then
    v_errors := array_append(v_errors, 'Invalid Qty');
  end if;
  if v_gross is null then
    v_errors := array_append(v_errors, 'Invalid Gross Sales');
  end if;
  if v_discounts is null then
    v_errors := array_append(v_errors, 'Invalid Discounts');
  end if;
  if v_net is null then
    v_errors := array_append(v_errors, 'Invalid Net Sales');
  end if;

  -- First use an explicit location-specific mapping; then allow an exact active menu-name match.
  select pm.menu_item_id
    into v_menu_item_id
  from public.pos_item_mappings pm
  where pm.organization_id = v_org_id
    and pm.location_id = v_location_id
    and pm.pos_source = 'square_csv'
    and pm.active
    and pm.menu_item_id is not null
    and (
      (v_sku is not null and pm.external_item_id = v_sku)
      or lower(pm.external_item_name) = lower(v_resolved_name)
    )
  order by case when v_sku is not null and pm.external_item_id = v_sku then 0 else 1 end
  limit 1;

  if v_menu_item_id is null and v_resolved_name is not null then
    select mi.id
      into v_menu_item_id
    from public.menu_items mi
    join public.location_menu_items lmi
      on lmi.menu_item_id = mi.id
     and lmi.location_id = v_location_id
     and lmi.active
    where mi.organization_id = v_org_id
      and mi.active
      and lower(mi.name) = lower(v_resolved_name)
    order by mi.id
    limit 1;
  end if;

  if v_menu_item_id is null and v_resolved_name is not null then
    v_errors := array_append(v_errors, 'Menu item mapping required');
  end if;

  new.normalized_data := jsonb_strip_nulls(jsonb_build_object(
    'source', 'square_csv',
    'occurred_at', v_occurred_at,
    'display_date', case when v_occurred_at is null then null else
      to_char(v_occurred_at at time zone v_timezone, 'MM/DD/YYYY') end,
    'display_time', case when v_occurred_at is null then null else
      to_char(v_occurred_at at time zone v_timezone, 'HH12:MI:SS AM') end,
    'timezone', v_timezone,
    'location_id', v_location_id,
    'location_name', v_location_name,
    'item_name', v_item,
    'price_point_name', v_price_point,
    'resolved_item_name', v_resolved_name,
    'sku', v_sku,
    'menu_item_id', v_menu_item_id,
    'quantity', v_qty,
    'gross_sales', v_gross,
    'discounts', v_discounts,
    'net_sales', v_net,
    'dining_option', nullif(btrim(new.raw_data->>'Dining Option'), ''),
    'channel', nullif(btrim(new.raw_data->>'Channel'), '')
  ));
  new.error_message := nullif(array_to_string(v_errors, '; '), '');
  new.processed := false;
  return new;
end;
$$;

drop trigger if exists trg_prepare_square_csv_import_row on public.sales_import_rows;
create trigger trg_prepare_square_csv_import_row
before insert or update of raw_data, batch_id
on public.sales_import_rows
for each row
execute function private.prepare_square_csv_import_row();

create or replace function public.process_square_csv_batch(p_batch_id uuid)
returns table(processed_rows integer, error_rows integer, status public.import_status)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.sales_import_batches%rowtype;
  v_processed integer;
  v_errors integer;
begin
  select * into v_batch
  from public.sales_import_batches
  where id = p_batch_id
    and pos_source = 'square_csv'
    and import_type = 'item_sales'
    and granularity = 'transaction';

  if not found then
    raise exception 'Square CSV item-sales batch not found';
  end if;

  update public.sales_import_batches
  set status = 'processing'
  where id = p_batch_id;

  insert into public.sales_item_facts (
    organization_id, location_id, import_batch_id, source_row_id,
    menu_item_id, external_item_id, external_item_name, fact_date,
    period_start, period_end, granularity, quantity,
    gross_sales, discounts, refunds, net_sales, dimensions
  )
  select
    v_batch.organization_id,
    v_batch.location_id,
    v_batch.id,
    r.id,
    (r.normalized_data->>'menu_item_id')::uuid,
    nullif(r.normalized_data->>'sku', ''),
    r.normalized_data->>'resolved_item_name',
    ((r.normalized_data->>'occurred_at')::timestamptz
      at time zone (r.normalized_data->>'timezone'))::date,
    (r.normalized_data->>'occurred_at')::timestamptz,
    (r.normalized_data->>'occurred_at')::timestamptz + interval '1 microsecond',
    'transaction'::public.data_granularity,
    (r.normalized_data->>'quantity')::numeric,
    (r.normalized_data->>'gross_sales')::numeric,
    (r.normalized_data->>'discounts')::numeric,
    null,
    (r.normalized_data->>'net_sales')::numeric,
    jsonb_strip_nulls(jsonb_build_object(
      'price_point_name', r.normalized_data->>'price_point_name',
      'timezone', r.normalized_data->>'timezone',
      'dining_option', r.normalized_data->>'dining_option',
      'channel', r.normalized_data->>'channel',
      'display_date', r.normalized_data->>'display_date',
      'display_time', r.normalized_data->>'display_time'
    ))
  from public.sales_import_rows r
  where r.batch_id = p_batch_id
    and r.error_message is null
    and r.normalized_data->>'menu_item_id' is not null
  on conflict (source_row_id) where source_row_id is not null
  do update set
    menu_item_id = excluded.menu_item_id,
    external_item_id = excluded.external_item_id,
    external_item_name = excluded.external_item_name,
    fact_date = excluded.fact_date,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    quantity = excluded.quantity,
    gross_sales = excluded.gross_sales,
    discounts = excluded.discounts,
    net_sales = excluded.net_sales,
    dimensions = excluded.dimensions;

  update public.sales_import_rows r
  set processed = true
  where r.batch_id = p_batch_id
    and r.error_message is null
    and r.normalized_data->>'menu_item_id' is not null;

  select count(*) filter (where processed),
         count(*) filter (where error_message is not null)
    into v_processed, v_errors
  from public.sales_import_rows
  where batch_id = p_batch_id;

  update public.sales_import_batches
  set processed_rows = v_processed,
      error_rows = v_errors,
      total_rows = (select count(*) from public.sales_import_rows where batch_id = p_batch_id),
      status = case when v_errors > 0
        then 'completed_with_errors'::public.import_status
        else 'completed'::public.import_status end,
      processed_at = now()
  where id = p_batch_id;

  return query
  select v_processed, v_errors,
    case when v_errors > 0
      then 'completed_with_errors'::public.import_status
      else 'completed'::public.import_status end;
end;
$$;

-- Authenticated managers may stage and process imports only for locations they can access.
create policy sales_import_batches_insert_manager
on public.sales_import_batches for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  and (uploaded_by is null or uploaded_by = (select auth.uid()))
);

create policy sales_import_batches_update_manager
on public.sales_import_batches for update to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
)
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
);

create policy sales_import_rows_insert_manager
on public.sales_import_rows for insert to authenticated
with check (
  exists (
    select 1 from public.sales_import_batches b
    where b.id = batch_id
  )
);

create policy sales_import_rows_update_manager
on public.sales_import_rows for update to authenticated
using (
  exists (
    select 1 from public.sales_import_batches b
    where b.id = batch_id
  )
)
with check (
  exists (
    select 1 from public.sales_import_batches b
    where b.id = batch_id
  )
);

create policy sales_item_facts_insert_manager
on public.sales_item_facts for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
);

create policy sales_item_facts_update_manager
on public.sales_item_facts for update to authenticated
using (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
)
with check (
  private.is_org_member(organization_id)
  and private.can_location(location_id)
  and private.has_org_role(organization_id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
);

-- Folder convention: organization_id/batch_id/file.csv
create policy sales_imports_select_manager
on storage.objects for select to authenticated
using (
  bucket_id = 'sales-imports'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and private.is_org_member(o.id)
      and private.has_org_role(o.id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

create policy sales_imports_insert_manager
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sales-imports'
  and lower(storage.extension(name)) = 'csv'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and private.is_org_member(o.id)
      and private.has_org_role(o.id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

create policy sales_imports_update_manager
on storage.objects for update to authenticated
using (
  bucket_id = 'sales-imports'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and private.is_org_member(o.id)
      and private.has_org_role(o.id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
)
with check (
  bucket_id = 'sales-imports'
  and lower(storage.extension(name)) = 'csv'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and private.is_org_member(o.id)
      and private.has_org_role(o.id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

create policy sales_imports_delete_manager
on storage.objects for delete to authenticated
using (
  bucket_id = 'sales-imports'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and private.is_org_member(o.id)
      and private.has_org_role(o.id, array['owner'::public.member_role,'admin'::public.member_role,'manager'::public.member_role])
  )
);

revoke all on function public.process_square_csv_batch(uuid) from public;
grant execute on function public.process_square_csv_batch(uuid) to authenticated;
revoke all on function private.square_csv_resolved_item_name(text,text) from public;
revoke all on function private.square_csv_numeric(text) from public;
revoke all on function private.square_csv_timestamp(text,text,text) from public;
revoke all on function private.prepare_square_csv_import_row() from public;

grant select, insert, update on public.sales_import_batches to authenticated;
grant select, insert, update on public.sales_import_rows to authenticated;
grant select, insert, update on public.sales_item_facts to authenticated;

;
