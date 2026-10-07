CREATE OR REPLACE FUNCTION private.square_csv_timestamp(p_date text, p_time text, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_date date;
  v_time time;
begin
  if p_timezone is null or btrim(p_timezone) = '' then
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
$function$

;
