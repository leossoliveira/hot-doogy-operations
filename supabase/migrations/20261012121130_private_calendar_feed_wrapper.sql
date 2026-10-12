-- Keep the privileged bearer read in the unexposed schema; public entry only delegates.
alter function public.my_day_calendar_feed(text) set schema private;
create function public.my_day_calendar_feed(p_hash text) returns jsonb language sql stable security invoker set search_path='' as $$
 select private.my_day_calendar_feed(p_hash);
$$;
revoke all on function public.my_day_calendar_feed(text) from public;
grant execute on function public.my_day_calendar_feed(text) to anon,authenticated;
notify pgrst,'reload schema';
