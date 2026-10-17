-- A smaller end time means the following day; equal times remain invalid.
-- Preserve the deployed submission function and its access checks.
do $migration$
declare
 definition text := pg_get_functiondef('public.careers_submit(jsonb,text,text)'::regprocedure);
 start_at integer;
 end_at integer;
 validation text := $validation$ for day in select value from jsonb_array_elements(p->'availability') loop
  if coalesce(day.value->>'day','') not in ('sun','mon','tue','wed','thu','fri','sat')
   or coalesce(day.value->>'from','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(day.value->>'to','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or (day.value->>'from') = (day.value->>'to') then
   raise exception 'Availability times are invalid' using errcode = '22023';
  end if;
 end loop;$validation$;
begin
 start_at := strpos(definition, ' for day in select value from jsonb_array_elements');
 end_at := strpos(substr(definition, start_at), ' end loop;');
 if start_at = 0 or end_at = 0 then raise exception 'Submission validation block not found'; end if;
 execute substr(definition, 1, start_at - 1) || validation || substr(definition, start_at + end_at - 1 + length(' end loop;'));
end;
$migration$;
