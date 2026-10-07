CREATE OR REPLACE FUNCTION private.restaurant_key(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
 select case normalized when 'no tomatos' then 'no tomatoes' else normalized end
 from (select lower(regexp_replace(btrim(coalesce(p_text,'')), '[[:space:]]+', ' ', 'g')) as normalized) x;
$function$;
;
