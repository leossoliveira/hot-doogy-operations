-- Resolve the private function at creation, without granting anon access to the private schema.
create or replace function public.my_day_calendar_feed(p_hash text) returns jsonb language sql stable security invoker set search_path=''
return private.my_day_calendar_feed(p_hash);
notify pgrst,'reload schema';
